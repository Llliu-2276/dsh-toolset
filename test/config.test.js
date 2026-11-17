import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { defaultConfig, loadConfig, normalizeConfig, saveConfig } from "../src/config.js";

function tempFile() {
  return join(mkdtempSync(join(tmpdir(), "dsh-toolset-")), "workbenches.json");
}

test("defaultConfig starts empty", () => {
  const config = defaultConfig();
  assert.equal(config.version, 1);
  assert.equal(config.lastSelected, null);
  assert.deepEqual(config.global.tools, []);
  assert.deepEqual(config.benches, []);
});

test("normalizeConfig accepts a well formed document", () => {
  const result = normalizeConfig({
    version: 1,
    lastSelected: "b1",
    global: { tools: ["pwsh"] },
    benches: [{ id: "b1", name: "办公", tools: ["read"], createdAt: 1 }],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.config.benches[0].tools, ["read"]);
});

test("normalizeConfig rejects a tool in both global and a workbench", () => {
  const result = normalizeConfig({
    version: 1,
    global: { tools: ["pwsh"] },
    benches: [{ id: "b1", name: "办公", tools: ["pwsh"] }],
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /全局/);
});

test("normalizeConfig rejects duplicate ids and names", () => {
  const duplicateId = normalizeConfig({
    version: 1,
    global: { tools: [] },
    benches: [
      { id: "b1", name: "一", tools: [] },
      { id: "b1", name: "二", tools: [] },
    ],
  });
  assert.equal(duplicateId.ok, false);

  const duplicateName = normalizeConfig({
    version: 1,
    global: { tools: [] },
    benches: [
      { id: "b1", name: "同名", tools: [] },
      { id: "b2", name: "同名", tools: [] },
    ],
  });
  assert.equal(duplicateName.ok, false);
});

test("normalizeConfig clears a dangling lastSelected", () => {
  const result = normalizeConfig({ version: 1, lastSelected: "ghost", global: { tools: [] }, benches: [] });
  assert.equal(result.ok, true);
  assert.equal(result.config.lastSelected, null);
});

test("normalizeConfig rejects an unknown version", () => {
  const result = normalizeConfig({ version: 2, global: { tools: [] }, benches: [] });
  assert.equal(result.ok, false);
});

test("loadConfig returns an empty configuration when the file is missing", () => {
  const file = tempFile();
  const loaded = loadConfig(file);
  assert.equal(loaded.missing, true);
  assert.equal(loaded.degraded, false);
  assert.deepEqual(loaded.config.benches, []);
});

test("loadConfig degrades on broken JSON without touching the file", () => {
  const file = tempFile();
  writeFileSync(file, "{ not json", "utf8");
  const loaded = loadConfig(file);
  assert.equal(loaded.degraded, true);
  assert.equal(readFileSync(file, "utf8"), "{ not json");
});

test("saveConfig writes atomically and keeps a backup", () => {
  const file = tempFile();
  saveConfig(file, { version: 1, lastSelected: null, global: { tools: [] }, benches: [] });
  assert.equal(existsSync(file), true);

  const next = defaultConfig();
  next.global.tools.push("pwsh");
  saveConfig(file, next);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).global.tools, ["pwsh"]);
  assert.equal(existsSync(`${file}.bak`), true);
});
