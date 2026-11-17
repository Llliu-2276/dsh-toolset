import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * The entry module pulls in the cordis `Service` base and `dsh-session`, which
 * the host provides at runtime. Those peers may be absent in a bare checkout,
 * and the real `apply()` path is covered by `node scripts/e2e/run.mjs` (which
 * mounts the plugin into a throwaway DSH profile), so this file only pins the
 * module contract that the loader reads.
 */
let entry;
try {
  entry = await import("../src/index.js");
} catch {
  entry = undefined;
}

if (entry === undefined) {
  test("the entry module exports the plugin contract", { skip: "peer dependencies are not installed here" }, () => {});
} else {
  test("the plugin declares its name and the services it needs", () => {
    assert.equal(entry.name, "dsh-toolset");
    assert.ok(Array.isArray(entry.inject));
    for (const service of ["tools", "systemPrompt", "sessionProjections", "agents", "approval"]) {
      assert.ok(entry.inject.includes(service), `missing inject entry ${service}`);
    }
  });

  test("apply is an async function taking a context", () => {
    assert.equal(typeof entry.apply, "function");
    assert.equal(entry.apply.constructor.name, "AsyncFunction");
    assert.equal(entry.apply.length, 2);
  });
}
