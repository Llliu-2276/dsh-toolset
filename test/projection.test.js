import assert from "node:assert/strict";
import { test } from "node:test";
import { registerWorkbenchProjection } from "../src/projection.js";
import { FROZEN_EVENT, SELECTED_EVENT } from "../src/core.js";

function setup({ last = null, benches = [] } = {}) {
  let spec;
  const ctx = {
    sessionProjections: {
      register(value) {
        spec = value;
        return value;
      },
    },
  };
  const byId = new Map(benches.map((bench) => [bench.id, bench]));
  const service = {
    lastSelectedId: last,
    has: (id) => byId.has(id),
    benchById: (id) => byId.get(id) ?? null,
  };
  registerWorkbenchProjection(ctx, service);
  return {
    view: (state) => spec.wire.view(state),
    init: () => spec.init(),
    apply: (state, type, data) => spec.apply(state, { type, data }),
  };
}

const office = { id: "b1", name: "办公" };

test("an untouched conversation shows the last selection", () => {
  const projection = setup({ last: "b1", benches: [office] });
  const view = projection.view(projection.init());
  assert.equal(view.benchId, "b1");
  assert.equal(view.name, "办公");
  assert.equal(view.started, false);
  assert.equal(view.deleted, false);
});

test("an untouched conversation without a last selection shows nothing", () => {
  const projection = setup();
  const view = projection.view(projection.init());
  assert.equal(view.benchId, null);
  assert.equal(view.name, null);
  assert.equal(view.deleted, false);
});

test("an explicit selection wins over the last selection", () => {
  const projection = setup({ last: "b1", benches: [office] });
  const state = projection.apply(projection.init(), SELECTED_EVENT, { benchId: null, name: null });
  const view = projection.view(state);
  assert.equal(view.benchId, null);
  assert.equal(view.name, null);
});

test("a frozen conversation keeps its own bench after the last selection moves", () => {
  const projection = setup({ last: "b1", benches: [office] });
  const state = projection.apply(projection.init(), FROZEN_EVENT, {
    benchId: null,
    name: null,
    core: ["read"],
    global: [],
    bench: [],
    allowed: ["read", "grep"],
  });
  const view = projection.view(state);
  assert.equal(view.benchId, null);
  assert.equal(view.name, null);
  assert.equal(view.started, true);
  assert.deepEqual(view.core, ["read"]);
  assert.deepEqual(view.allowed, ["read", "grep"]);
});

test("a frozen bench that was removed is marked deleted", () => {
  const projection = setup();
  const state = projection.apply(projection.init(), FROZEN_EVENT, {
    benchId: "b9",
    name: "旧工作台",
    core: [],
    global: [],
    bench: ["read"],
  });
  const view = projection.view(state);
  assert.equal(view.benchId, "b9");
  assert.equal(view.name, "旧工作台");
  assert.equal(view.deleted, true);
});
