import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCatalog, firstSentence } from "../src/catalog.js";
import { MaskEngine } from "../src/mask.js";

test("firstSentence flattens and truncates", () => {
  assert.equal(firstSentence("打开一个文件。后面还有。"), "打开一个文件");
  assert.equal(firstSentence("  Read   a file.\nMore text "), "Read a file");
  assert.equal(firstSentence(undefined), "");
  const long = "x".repeat(200);
  assert.ok(firstSentence(long).length <= 81);
});

test("catalog lists unavailable tools with purpose and owner", () => {
  const ctx = {
    tools: {
      view: () => ({
        knownNames: new Set(["read", "office_open", "pwsh"]),
        visible: new Map([["read", {}]]),
      }),
      get: () => undefined,
    },
  };
  const service = {
    ownerOf: (name) =>
      name === "pwsh" ? { kind: "global" } : { kind: "bench", id: "b1", name: "办公" },
  };
  const engine = {
    stateFor: () => ({
      name: "办公",
      defs: new Map([["office_open", { description: "Open an office document. Extra detail." }]]),
    }),
  };

  const text = buildCatalog(ctx, service, engine, { agent: { id: "s1", ctx: {} } });
  assert.match(text, /office_open：Open an office document/);
  assert.match(text, /pwsh（全局）/);
  assert.match(text, /当前工作台：「办公」/);
  assert.match(text, /request_tool/);
  assert.doesNotMatch(text, /^- read/m);
});

test("catalog is empty when every tool is available", () => {
  const ctx = {
    tools: {
      view: () => ({ knownNames: new Set(["read"]), visible: new Map([["read", {}]]) }),
      get: () => undefined,
    },
  };
  const text = buildCatalog(ctx, { ownerOf: () => ({ kind: "global" }) }, { stateFor: () => undefined }, {
    agent: { id: "s1", ctx: {} },
  });
  assert.equal(text, "");
});

test("allow list is intersected with restrictable names", () => {
  const ctx = {
    tools: { view: () => ({ restrictableNames: new Set(["read", "pwsh"]) }) },
    agents: { list: () => [], isOwnedBy: () => false },
  };
  const engine = new MaskEngine(ctx, { readOnly: false, lastSelectedId: null }, console);
  const allow = engine.allowedNames({
    agent: { ctx: {} },
    core: ["read", "ask_user_question"],
    global: ["pwsh"],
    bench: ["office_open"],
    grants: new Set(["grep"]),
  });
  assert.deepEqual([...allow].sort(), ["pwsh", "read"]);
});
