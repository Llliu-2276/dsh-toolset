import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

/**
 * `WorkbenchService` extends the cordis `Service` base, which is a peer
 * dependency resolved by the host at runtime. The tests run inside the plugin
 * repository, where it may not be installed, so they only run for real when it
 * is: everything else about the store is covered by store.test.js and the HTTP
 * routes by http.test.js.
 */
let Service;
let Context;
try {
  ({ Service, Context } = await import("@deepseek-ai/cordis"));
} catch {
  Service = undefined;
  Context = undefined;
}

if (Service === undefined) {
  test("the service forwards the store API", { skip: "@deepseek-ai/cordis is not installed here" }, () => {});
} else {
  const { WorkbenchService } = await import("../src/service.js");

  function createService() {
    const file = join(mkdtempSync(join(tmpdir(), "dsh-toolset-service-")), "workbenches.json");
    const ctx = new Context();
    const service = new WorkbenchService(ctx, { file });
    return { service, file, ctx };
  }

  test("the service exposes the store through its own surface", () => {
    const { service, file } = createService();
    assert.equal(service.file, file);
    assert.equal(service.readOnly, false);
    assert.equal(service.degraded, false);
    assert.equal(service.lastSelectedId, null);
    assert.deepEqual(service.list().benches, []);
  });

  test("mutations go through the store and stay readable", () => {
    const { service } = createService();
    const bench = service.create("办公", "矩阵");
    assert.equal(service.has(bench.id), true);
    assert.equal(service.benchById(bench.id).description, "矩阵");

    service.setTools("bench", bench.id, ["grep"]);
    service.setLastSelected(bench.id);
    assert.equal(service.lastSelectedId, bench.id);

    const resolved = service.resolve(bench.id);
    assert.deepEqual(resolved.bench, ["grep"]);
    assert.equal(resolved.name, "办公");

    service.update(bench.id, { name: "调研" });
    assert.equal(service.benchById(bench.id).name, "调研");

    service.remove(bench.id);
    assert.equal(service.has(bench.id), false);
    assert.equal(service.lastSelectedId, null);
  });

  test("reorder and ownership queries reach the store", () => {
    const { service } = createService();
    const first = service.create("A");
    const second = service.create("B");
    assert.deepEqual(service.reorderBenches([second.id, first.id]), [second.id, first.id]);

    service.setTools("global", null, ["grep"]);
    assert.deepEqual(service.ownerOf("grep"), { kind: "global" });
    assert.deepEqual(service.ownerOf("ghost"), { kind: "unclassified" });

    service.reorderTools(["grep", "read"]);
    assert.deepEqual(service.list().toolOrder, ["grep", "read"]);
  });
}
