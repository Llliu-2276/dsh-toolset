import assert from "node:assert/strict";
import { test } from "node:test";

import { REQUEST_TOOL } from "../src/core.js";
import { registerRequestTool } from "../src/request-tool.js";

const agent = { id: "session-1", session: { id: "session-1" } };

function setup({ known = ["grep"], visible = [], outcome = "allowed-once", throws } = {}) {
  const grants = [];
  let definition;
  const ctx = {
    tools: {
      register(def) {
        definition = def;
        return () => {};
      },
      view: () => ({ knownNames: new Set(known), visible: new Set(visible) }),
    },
    approval: {
      async request(request) {
        if (throws) throw new Error(throws);
        grants.push(request);
        return outcome;
      },
    },
  };
  const engine = {
    grant(sessionId, name) {
      grants.push({ sessionId, name });
      return true;
    },
  };
  const warnings = [];
  registerRequestTool(ctx, { engine, log: { warn: (message) => warnings.push(message) } });
  return { definition, grants, warnings, engine };
}

test("request_tool asks for approval once and grants the tool for the turn", async () => {
  const { definition, grants } = setup({ known: ["grep"], visible: [] });
  assert.equal(definition.name, REQUEST_TOOL);
  assert.deepEqual(definition.parameters.required, ["tool"]);

  const text = await definition.execute({ tool: " grep ", reason: "需要搜索" }, { agent });
  assert.equal(grants[0].toolName, "grep");
  assert.match(grants[0].displayReason, /grep/);
  assert.match(grants[0].displayReason, /需要搜索/);
  assert.equal(grants[1].sessionId, "session-1");
  assert.equal(grants[1].name, "grep");
  assert.match(text, /已获准/);
});

test("a rejected approval tells the model not to ask again", async () => {
  const { definition, grants } = setup({ known: ["grep"], outcome: "rejected" });
  const text = await definition.execute({ tool: "grep" }, { agent });
  assert.match(text, /没有批准/);
  assert.equal(grants.length, 1);
});

test("an approval that throws is reported instead of crashing the turn", async () => {
  const { definition, warnings } = setup({ known: ["grep"], throws: "no answerer" });
  const text = await definition.execute({ tool: "grep" }, { agent });
  assert.match(text, /申请「grep」失败：no answerer/);
  assert.equal(warnings.length, 1);
});

test("unknown, already-visible and empty tool names return guidance", async () => {
  const unknown = setup({ known: ["grep"] });
  assert.match(await unknown.definition.execute({ tool: "nope" }, { agent }), /没有名为「nope」的工具/);

  const visible = setup({ known: ["grep"], visible: ["grep"] });
  assert.match(await visible.definition.execute({ tool: "grep" }, { agent }), /已经可以直接调用/);

  const empty = setup();
  assert.match(await empty.definition.execute({}, { agent }), /没有指定工具名/);
  assert.equal(empty.grants.length, 0);
});

test("a grant that finds no workbench state is reported", async () => {
  const { definition, engine } = setup({ known: ["grep"] });
  engine.grant = () => false;
  const text = await definition.execute({ tool: "grep" }, { agent });
  assert.match(text, /没有加载工作台状态/);
});
