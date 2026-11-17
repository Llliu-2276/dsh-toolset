import test from "node:test";
import assert from "node:assert/strict";

import { MaskEngine } from "../src/mask.js";
import { CORE_TOOLS, FROZEN_EVENT, REQUEST_TOOL } from "../src/core.js";

function makeAgent(id, events = []) {
  return {
    id,
    session: { id, snapshotEvents: () => events },
    ctx: {
      tools: {
        restrict({ allow }) {
          return () => {};
        },
      },
    },
  };
}

function fakeCtx({ restrictable = [...CORE_TOOLS, "web_search", "univer_execute", REQUEST_TOOL], registered = [] } = {}) {
  const restrictCalls = [];
  const agentList = [];
  const agent = {
    id: "session-1",
    session: { snapshotEvents: () => [] },
    ctx: {
      tools: {
        restrict({ allow }) {
          restrictCalls.push([...allow]);
          return () => {};
        },
      },
    },
  };
  agentList.push(agent);
  const ctx = {
    agents: {
      list: () => agentList,
      get: (id) => agentList.find((candidate) => candidate.id === id),
      isOwnedBy: () => false,
    },
    tools: {
      view: () => ({
        restrictableNames: new Set(restrictable),
        registrations: new Map(registered.map(([name, definition]) => [name, { definition }])),
      }),
    },
  };
  return { ctx, agent, agentList, restrictCalls };
}

function fakeService({ lastSelectedId = null, bench = null } = {}) {
  return {
    lastSelectedId,
    readOnly: false,
    benchById: (id) => (bench && bench.id === id ? bench : undefined),
    resolve: () => ({
      benchId: bench?.id ?? null,
      name: bench?.name ?? null,
      core: [...CORE_TOOLS],
      global: [],
      bench: bench ? [...bench.tools] : [],
    }),
    setLastSelected: () => {},
  };
}

const office = { id: "b1", name: "鍔炲叕", tools: ["web_search"] };

test("attaching to a live agent does not restrict its tools", () => {
  const { ctx, agent, restrictCalls } = fakeCtx();
  const engine = new MaskEngine(ctx, fakeService(), undefined, undefined);
  engine.attach(agent);
  assert.equal(restrictCalls.length, 0);
});

test("selecting a workbench before the first message does not restrict yet", () => {
  const { ctx, agent, restrictCalls } = fakeCtx();
  const engine = new MaskEngine(ctx, fakeService({ bench: office }), undefined, { selected() {} });
  engine.attach(agent);
  engine.select(agent, office.id);
  assert.equal(restrictCalls.length, 0);
});

test("turn start applies core plus the workbench", () => {
  const { ctx, agent, restrictCalls } = fakeCtx();
  const engine = new MaskEngine(ctx, fakeService({ bench: office }), undefined, undefined);
  engine.attach(agent);
  engine.onTurnStart(agent);
  assert.equal(restrictCalls.length, 1);
  const allow = restrictCalls[0];
  for (const name of CORE_TOOLS) assert.ok(allow.includes(name), `missing core tool ${name}`);
  assert.ok(allow.includes("web_search"));
  assert.ok(allow.includes(REQUEST_TOOL));
});

test("a view that exposes no workbench tools is left alone", () => {
  const { ctx, agent, restrictCalls } = fakeCtx({ restrictable: [REQUEST_TOOL] });
  const engine = new MaskEngine(ctx, fakeService(), undefined, undefined);
  engine.attach(agent);
  engine.onTurnStart(agent);
  assert.equal(restrictCalls.length, 0);
});

test("a grant is admitted for the turn and withdrawn at turn end", () => {
  const { ctx, agent, restrictCalls } = fakeCtx();
  const engine = new MaskEngine(ctx, fakeService({ bench: office }), undefined, undefined);
  engine.attach(agent);
  engine.onTurnStart(agent);

  assert.equal(engine.grant(agent.id, "univer_execute"), true);
  assert.ok(restrictCalls.at(-1).includes("univer_execute"));

  engine.onTurnEnd(agent);
  assert.equal(restrictCalls.at(-1).includes("univer_execute"), false);
  assert.ok(restrictCalls.at(-1).includes("web_search"));
});

test("a grant does not survive into the next turn when turn end never arrived", () => {
  const { ctx, agent, restrictCalls } = fakeCtx();
  const engine = new MaskEngine(ctx, fakeService({ bench: office }), undefined, undefined);
  engine.attach(agent);
  engine.onTurnStart(agent);
  engine.grant(agent.id, "univer_execute");

  // An aborted turn may skip `turn/end`; the next start must still drop the grant.
  engine.onTurnStart(agent);
  assert.equal(restrictCalls.at(-1).includes("univer_execute"), false);
});

test("granting an unknown conversation is refused", () => {
  const { ctx } = fakeCtx();
  const engine = new MaskEngine(ctx, fakeService(), undefined, undefined);
  assert.equal(engine.grant("missing", "univer_execute"), false);
});

test("a subagent inherits the frozen set of its parent state", () => {
  const { ctx, agent, agentList, restrictCalls } = fakeCtx();
  const engine = new MaskEngine(ctx, fakeService({ bench: office }), undefined, undefined);
  engine.attach(agent);
  engine.onTurnStart(agent);

  const child = makeAgent("child-1");
  agentList.push(child);
  ctx.agents.isOwnedBy = (id, owner) => id === "child-1" && owner.id === agent.id;
  const state = engine.attach(child);
  assert.equal(state.started, true);
  assert.equal(state.inherited, true);
  assert.equal(state.benchId, office.id);
  assert.deepEqual(state.bench, ["web_search"]);

  engine.onTurnStart(child);
  assert.ok(restrictCalls.at(-1).includes("web_search"));
});

test("a subagent inherits the frozen record when the parent was never attached", () => {
  const { ctx, agent, agentList } = fakeCtx();
  const engine = new MaskEngine(ctx, fakeService(), undefined, undefined);
  const frozen = {
    benchId: "b9",
    name: "璋冪爺",
    core: ["read"],
    global: ["grep"],
    bench: ["web_search"],
  };
  const parent = makeAgent("parent-2", [{ type: FROZEN_EVENT, data: frozen }]);
  agentList.push(parent);
  const child = makeAgent("child-2");
  agentList.push(child);
  ctx.agents.isOwnedBy = (id, owner) => id === "child-2" && owner.id === "parent-2";

  const state = engine.attach(child);
  assert.equal(state.started, true);
  assert.equal(state.benchId, "b9");
  assert.deepEqual(state.global, ["grep"]);
  assert.deepEqual(state.bench, ["web_search"]);
  assert.deepEqual(state.core, ["read"]);
});

test("stateFor only reports conversations this engine attached", () => {
  const { ctx, agent } = fakeCtx();
  const engine = new MaskEngine(ctx, fakeService(), undefined, undefined);
  assert.equal(engine.stateFor(agent.id), undefined);
  engine.attach(agent);
  assert.equal(engine.stateFor(agent.id)?.sessionId, agent.id);
  assert.equal(engine.stateFor("other"), undefined);
});

