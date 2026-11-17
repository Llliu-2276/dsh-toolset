import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { WorkbenchStore } from "../src/store.js";

function createStore(initial) {
  const file = join(mkdtempSync(join(tmpdir(), "dsh-toolset-")), "workbenches.json");
  if (initial) writeFileSync(file, JSON.stringify(initial), "utf8");
  const events = [];
  const store = new WorkbenchStore({ emit: (name, payload) => events.push([name, payload]) }, { file });
  return { store, events, file };
}

test("create, rename and remove a workbench", () => {
  const { store, events } = createStore();
  const bench = store.create("  办公  ");
  assert.equal(bench.name, "办公");
  assert.equal(store.list().benches.length, 1);

  store.rename(bench.id, "写作");
  assert.equal(store.benchById(bench.id).name, "写作");

  store.remove(bench.id);
  assert.equal(store.list().benches.length, 0);
  assert.ok(events.every(([name]) => name === "workbench/changed"));
});

test("duplicate names are rejected", () => {
  const { store } = createStore();
  store.create("办公");
  assert.throws(() => store.create("办公"), /已经有一个/);
});

test("adding a tool to global removes it from every workbench", () => {
  const { store } = createStore();
  const a = store.create("A");
  const b = store.create("B");
  store.setTools("bench", a.id, ["grep", "pwsh"]);
  store.setTools("bench", b.id, ["grep", "read"]);

  const moved = store.moveToGlobal(["grep"]);
  assert.deepEqual(moved.added, ["grep"]);
  assert.equal(moved.removedFrom.length, 2);

  assert.deepEqual(store.list().global.tools, ["grep"]);
  assert.deepEqual(store.benchById(a.id).tools, ["pwsh"]);
  assert.deepEqual(store.benchById(b.id).tools, ["read"]);
});

test("a workbench silently drops tools that live in global", () => {
  const { store } = createStore();
  const bench = store.create("A");
  store.setTools("global", null, ["pwsh"]);
  store.setTools("bench", bench.id, ["pwsh", "read"]);
  assert.deepEqual(store.benchById(bench.id).tools, ["read"]);
});

test("resolve returns the frozen pieces for a conversation", () => {
  const { store } = createStore();
  const bench = store.create("办公");
  store.setTools("global", null, ["pwsh"]);
  store.setTools("bench", bench.id, ["office_open"]);

  const resolved = store.resolve(bench.id);
  assert.ok(resolved.core.includes("read"));
  assert.deepEqual(resolved.global, ["pwsh"]);
  assert.deepEqual(resolved.bench, ["office_open"]);
  assert.equal(resolved.name, "办公");

  const withoutBench = store.resolve(null);
  assert.equal(withoutBench.benchId, null);
  assert.deepEqual(withoutBench.bench, []);
  assert.deepEqual(withoutBench.global, ["pwsh"]);
});

test("removing the last selected workbench clears lastSelected", () => {
  const { store } = createStore();
  const bench = store.create("办公");
  store.setLastSelected(bench.id);
  assert.equal(store.lastSelectedId, bench.id);
  store.remove(bench.id);
  assert.equal(store.lastSelectedId, null);
});

test("ownerOf reports global, workbench and unclassified", () => {
  const { store } = createStore();
  const bench = store.create("办公");
  store.setTools("global", null, ["pwsh"]);
  store.setTools("bench", bench.id, ["office_open"]);

  assert.equal(store.ownerOf("pwsh").kind, "global");
  assert.deepEqual(store.ownerOf("office_open"), { kind: "bench", id: bench.id, name: "办公" });
  assert.equal(store.ownerOf("unknown").kind, "unclassified");
});

test("a degraded file blocks every write", () => {
  const file = join(mkdtempSync(join(tmpdir(), "dsh-toolset-")), "workbenches.json");
  writeFileSync(file, "{ broken", "utf8");
  const store = new WorkbenchStore({ emit: () => {} }, { file });
  assert.equal(store.readOnly, true);
  assert.throws(() => store.create("办公"), /配置损坏/);
});
