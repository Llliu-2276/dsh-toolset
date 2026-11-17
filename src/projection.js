import { FROZEN_EVENT, SELECTED_EVENT } from "./core.js";

/** Key of the `workbench` session projection. */
export const WORKBENCH_PROJECTION = "workbench";

const passthrough = { parse: (value) => value };

function emptyState() {
  return {
    benchId: null,
    name: null,
    selected: false,
    started: false,
    core: [],
    global: [],
    bench: [],
    allowed: [],
  };
}

/**
 * Register the `workbench` projection: the client reads it through
 * `session.projections.faceOf("workbench")`, the host through `stateOf(session)`.
 * @param ctx - plugin context.
 * @param service - workbench service, used to compute `deleted`.
 */
export function registerWorkbenchProjection(ctx, service) {
  return ctx.sessionProjections.register({
    key: WORKBENCH_PROJECTION,
    stateVersion: 0,
    stateSchema: passthrough,
    init: () => emptyState(),
    apply(state, event) {
      const data = event.data ?? {};
      if (event.type === SELECTED_EVENT) {
        if (state.started) return state;
        return {
          ...state,
          benchId: data.benchId ?? null,
          name: data.name ?? null,
          selected: true,
        };
      }
      if (event.type === FROZEN_EVENT) {
        return {
          benchId: data.benchId ?? null,
          name: data.name ?? null,
          selected: true,
          started: true,
          core: [...(data.core ?? [])],
          global: [...(data.global ?? [])],
          bench: [...(data.bench ?? [])],
          allowed: [...(data.allowed ?? [])],
        };
      }
      return state;
    },
    wire: {
      viewSchema: passthrough,
      view: (state) => {
        // A conversation that never wrote a selection still sends the default
        // tool set (`lastSelected`), so the projection has to name it as well.
        const fallback = state.started || state.selected ? null : service.lastSelectedId;
        const benchId = state.benchId ?? fallback;
        const name =
          state.benchId !== null ? state.name : (service.benchById(benchId)?.name ?? null);
        return {
          ...state,
          benchId,
          name,
          deleted: benchId !== null && !service.has(benchId),
        };
      },
    },
  });
}
