import { REQUEST_TOOL } from "./core.js";
import { scanWorkbenchEvents } from "./session.js";

function disposeOf(value) {
  if (typeof value === "function") {
    value();
    return;
  }
  if (value && typeof value.dispose === "function") value.dispose();
}

/**
 * Applies one agent-scoped `restrict()` per conversation and rebuilds it when
 * the conversation's workbench, grants or turn boundaries change.
 *
 * The allow list is `CORE ∪ global ∪ bench ∪ grants`, intersected with the
 * inherited tool names (`restrictableNames`): tools registered in the agent's
 * own layer (this plugin's `request_tool`) are always visible and cannot be
 * named in a restriction.
 */
export class MaskEngine {
  constructor(ctx, service, log, recorder) {
    this.ctx = ctx;
    this.service = service;
    this.log = log;
    this.recorder = recorder;
    this.states = new Map();
  }

  stateFor(sessionId) {
    return this.states.get(sessionId);
  }

  /**
   * The frozen set a subagent inherits: the parent's live state when this
   * plugin saw its first turn, else the parent's frozen record from the session
   * log (a restart mid-conversation leaves no state behind).
   */
  findInherited(agent) {
    for (const candidate of this.ctx.agents.list()) {
      if (candidate.id === agent.id) continue;
      if (!this.ctx.agents.isOwnedBy(agent.id, candidate)) continue;
      const state = this.states.get(candidate.id);
      if (state?.started) return state;
      const { frozen } = scanWorkbenchEvents(candidate.session.snapshotEvents());
      if (frozen) {
        return {
          started: true,
          benchId: frozen.benchId ?? null,
          name: frozen.name ?? null,
          core: [...(frozen.core ?? [])],
          global: [...(frozen.global ?? [])],
          bench: [...(frozen.bench ?? [])],
        };
      }
    }
    return undefined;
  }

  attach(agent) {
    if (this.states.has(agent.id)) return this.states.get(agent.id);
    const { selected, frozen } = scanWorkbenchEvents(agent.session.snapshotEvents());
    const inherited = this.findInherited(agent);
    const state = {
      sessionId: agent.id,
      agent,
      benchId: null,
      name: null,
      started: false,
      core: [],
      global: [],
      bench: [],
      grants: new Set(),
      defs: new Map(),
      disposer: undefined,
      inherited: false,
    };

    if (frozen) {
      state.started = true;
      state.benchId = frozen.benchId ?? null;
      state.name = frozen.name ?? null;
      state.core = [...(frozen.core ?? [])];
      state.global = [...(frozen.global ?? [])];
      state.bench = [...(frozen.bench ?? [])];
    } else if (selected) {
      state.benchId = selected.benchId ?? null;
      state.name = selected.name ?? null;
    } else {
      state.benchId = this.service.lastSelectedId;
      state.name = this.service.benchById(state.benchId)?.name ?? null;
    }

    // A subagent inherits the parent's frozen set, not its temporary grants.
    if (!state.started && inherited?.started) {
      state.started = true;
      state.inherited = true;
      state.benchId = inherited.benchId;
      state.name = inherited.name;
      state.core = [...inherited.core];
      state.global = [...inherited.global];
      state.bench = [...inherited.bench];
    }

    this.states.set(agent.id, state);
    this.captureDefinitions(agent, state);
    // Restriction is applied on `turn/start`, once the workbench resolves and
    // the agent's own view is composed. Restricting here would mask everything
    // for an agent attached to a live session (the state has no tool sets yet).
    return state;
  }

  /** Remember every visible tool definition, so the catalog survives masking. */
  captureDefinitions(agent, state) {
    const view = this.ctx.tools.view(agent);
    const definitions = new Map();
    for (const [name, registration] of view.registrations) definitions.set(name, registration.definition);
    state.defs = definitions;
    return definitions;
  }

  allowedNames(state) {
    const { restrictableNames } = this.ctx.tools.view(state.agent);
    const allow = new Set();
    for (const name of state.core) if (restrictableNames.has(name)) allow.add(name);
    for (const name of state.global) if (restrictableNames.has(name)) allow.add(name);
    for (const name of state.bench) if (restrictableNames.has(name)) allow.add(name);
    for (const name of state.grants) if (restrictableNames.has(name)) allow.add(name);
    if (restrictableNames.has(REQUEST_TOOL)) allow.add(REQUEST_TOOL);
    return allow;
  }

  reapply(agent) {
    const state = this.states.get(agent.id);
    if (!state) return;
    disposeOf(state.disposer);
    state.disposer = undefined;
    // With the previous restriction gone, every inherited definition is visible.
    this.captureDefinitions(agent, state);
    if (this.service.readOnly) {
      this.log?.warn?.("workbench configuration is degraded; tool masking stays off");
      return;
    }
    const allow = this.allowedNames(state);
    if (allow.size === 0 || (allow.size === 1 && allow.has(REQUEST_TOOL))) {
      // Nothing resolved (or only our own `request_tool` is visible): leave the
      // tool set untouched. A request built from an empty visible set is
      // rejected by the provider ("at least one tool must have
      // defer_loading=false").
      this.log?.warn?.("allow list has no workbench tools yet; skipping tool restriction");
      return;
    }
    state.disposer = agent.ctx.tools.restrict({ allow: [...allow] });
  }

  onTurnStart(agent) {
    const state = this.states.get(agent.id) ?? this.attach(agent);
    if (!state) return;
    // A grant only lasts for the turn that asked for it. `turn/end` normally
    // clears it, but an aborted or crashed turn can start the next one without
    // that event, so the boundary is enforced here as well.
    if (state.grants.size > 0) state.grants.clear();
    if (state.started) {
      this.reapply(agent);
      return;
    }
    const resolved = this.service.resolve(state.benchId);
    state.started = true;
    state.benchId = resolved.benchId;
    state.name = resolved.name;
    state.core = resolved.core;
    state.global = resolved.global;
    state.bench = resolved.bench;
    const allowed = [...this.allowedNames(state)].filter((name) => name !== REQUEST_TOOL);
    // `turn/start` is being published right now, so the session refuses a
    // reentrant append; the record lands on the microtask queue instead.
    const recorder = this.recorder;
    if (recorder) {
      queueMicrotask(() => {
        try {
          recorder.frozen(agent.session, { ...resolved, allowed });
        } catch (error) {
          this.log?.warn?.(`could not record the frozen workbench: ${error.message}`);
        }
      });
    }
    this.reapply(agent);
  }

  onTurnEnd(agent) {
    const state = this.states.get(agent.id);
    if (!state || state.grants.size === 0) return;
    state.grants.clear();
    this.reapply(agent);
  }

  /** Select a workbench for a conversation that has not started yet. */
  select(agent, benchId) {
    const state = this.states.get(agent.id) ?? this.attach(agent);
    if (state.started) throw new Error("这个对话已经开始了，工作台不能再换；新对话可以重新选");
    const bench = benchId === null ? null : this.service.benchById(benchId);
    if (benchId !== null && !bench) throw new Error(`没有这个工作台：${benchId}`);
    this.recorder?.selected(agent.session, { benchId: bench?.id ?? null, name: bench?.name ?? null });
    state.benchId = bench?.id ?? null;
    state.name = bench?.name ?? null;
    // The mask lands on `turn/start`: selecting before the first message must
    // not restrict an agent whose tool view is not resolved yet.
    try {
      this.service.setLastSelected(state.benchId);
    } catch (error) {
      this.log?.warn?.(`could not remember the last workbench: ${error.message}`);
    }
    return state;
  }

  /** Admit one tool for the rest of the current turn. */
  grant(sessionId, toolName) {
    const state = this.states.get(sessionId);
    if (!state) return false;
    state.grants.add(toolName);
    const agent = this.ctx.agents.get(sessionId);
    if (agent) this.reapply(agent);
    return true;
  }

  onSessionEvent(session, event) {
    if (event?.type === "turn/start") {
      const agent = this.ctx.agents.get(session.id);
      if (agent) this.onTurnStart(agent);
      return;
    }
    if (event?.type === "turn/end") {
      const agent = this.ctx.agents.get(session.id);
      if (agent) this.onTurnEnd(agent);
    }
  }

  dispose() {
    for (const state of this.states.values()) disposeOf(state.disposer);
    this.states.clear();
  }
}
