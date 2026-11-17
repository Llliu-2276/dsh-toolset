import test from "node:test";
import assert from "node:assert/strict";

import { MaskEngine } from "../src/mask.js";
import { CORE_TOOLS, REQUEST_TOOL } from "../src/core.js";

function fakeCtx({ restrictable = [...CORE_TOOLS, "web_search", REQUEST_TOOL], registered = [] } = {}) {
  const restrictCalls = [];
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
  const ctx = {
    agents: {
      list: () => [],
      get: (id) => (id === agent.id ? agent : undefined),
      isOwnedBy: () => false,
    },
    tools: {
      view: () => ({
        restrictableNames: new Set(restrictable),
        registrations: new Map(registered.map(([name, definition]) => [name, { definition }])),
      }),
    },
  };
  return { ctx, agent, restrictCalls };
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

const office = { id: "b1", name: "办公", tools: ["web_search"] };

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
