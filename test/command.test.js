import assert from "node:assert/strict";
import { test } from "node:test";

import { registerWorkbenchCommand } from "../src/command.js";

const agent = { id: "session-1", session: { id: "session-1" } };

function setup({ benches = [], degraded = false, started = false, selectError } = {}) {
  const config = {
    benches: benches.map((bench, index) => ({ id: `b${index + 1}`, tools: [], ...bench })),
    degraded,
    error: degraded ? "bad file" : undefined,
  };
  const state = { benchId: config.benches[0]?.id ?? null, name: config.benches[0]?.name ?? null, started };
  const selected = [];
  let definition;
  const ctx = {
    commands: {
      register(def) {
        definition = def;
        return () => {};
      },
    },
  };
  const service = { list: () => config };
  const engine = {
    stateFor: () => state,
    attach: () => state,
    select(target, benchId) {
      if (selectError) throw new Error(selectError);
      selected.push([target, benchId]);
      state.benchId = benchId;
    },
  };
  registerWorkbenchCommand(ctx, { engine, service });
  return { definition, state, selected };
}

test("the command reports the current workbench and the list", () => {
  const { definition } = setup({
    benches: [
      { name: "办公", tools: ["grep", "pwsh"] },
      { name: "调研", tools: [] },
    ],
  });
  const result = definition.handler({ agent, rawInput: "  " });
  assert.equal(result.kind, "success");
  assert.match(result.text, /当前工作台：办公/);
  assert.match(result.text, /办公（2 个工具） ←/);
  assert.match(result.text, /调研（0 个工具）(?! ←)/);
});

test("an empty configuration points at the settings page", () => {
  const { definition } = setup();
  const result = definition.handler({ agent, rawInput: "" });
  assert.match(result.text, /还没有工作台/);
});

test("a started conversation says the workbench can no longer change", () => {
  const { definition } = setup({ benches: [{ name: "办公" }], started: true });
  const result = definition.handler({ agent, rawInput: "" });
  assert.match(result.text, /已开始，不能更换/);
});

test("naming a workbench selects it by name or by id", () => {
  const { definition, selected } = setup({ benches: [{ name: "调研" }] });

  const byName = definition.handler({ agent, rawInput: "调研" });
  assert.equal(byName.kind, "success");
  assert.match(byName.text, /工作台：调研/);
  assert.equal(selected.length, 1);
  assert.equal(selected[0][0], agent);

  definition.handler({ agent, rawInput: "b1" });
  assert.equal(selected.length, 2);
});

test("unknown names and a started conversation return errors, not throws", () => {
  const unknown = setup({ benches: [{ name: "办公" }] });
  const missing = unknown.definition.handler({ agent, rawInput: "调研" });
  assert.equal(missing.kind, "error");
  assert.match(missing.text, /没有叫「调研」的工作台/);

  const locked = setup({ benches: [{ name: "办公" }], selectError: "这个对话已经开始了" });
  const refused = locked.definition.handler({ agent, rawInput: "办公" });
  assert.equal(refused.kind, "error");
  assert.match(refused.text, /已经开始了/);
});

test("a degraded configuration is called out", () => {
  const { definition } = setup({ benches: [{ name: "办公" }], degraded: true });
  const result = definition.handler({ agent, rawInput: "" });
  assert.match(result.text, /配置损坏/);
  assert.match(result.text, /bad file/);
});
