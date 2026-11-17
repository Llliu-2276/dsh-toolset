import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";

import { registerWorkbenchHttp } from "../src/http.js";
import { WorkbenchStore } from "../src/store.js";

function createService(initial) {
  const file = join(mkdtempSync(join(tmpdir(), "dsh-toolset-http-")), "workbenches.json");
  const store = new WorkbenchStore({ emit() {} }, { file });
  for (const bench of initial ?? []) store.create(bench.name, bench.description ?? "");
  const service = {
    get readOnly() {
      return store.readOnly;
    },
    list: () => store.list(),
    create: (name, description) => store.create(name, description),
    update: (id, patch) => store.update(id, patch),
    remove: (id) => store.remove(id),
    setTools: (kind, benchId, tools) => store.setTools(kind, benchId, tools),
    reorderBenches: (ids) => store.reorderBenches(ids),
    reorderTools: (names) => store.reorderTools(names),
  };
  return { store, service };
}

const agent = { id: "session-1", session: { id: "session-1" } };

function fakeCtx(extra = {}) {
  const tools = new Map([["read", { definition: { description: "read a file" } }]]);
  const ctx = {
    connection: { requestRejection: () => undefined },
    agents: { get: (id) => (id === agent.id ? agent : undefined), list: () => [agent] },
    tools: {
      view: () => ({
        restrictableNames: new Set(["read", "grep", "univer_execute", "mcp__zen-status__set_status"]),
        registrations: tools,
        knownNames: new Set(tools.keys()),
        visible: new Set(["read"]),
      }),
      get: () => undefined,
    },
    ...extra,
  };
  let handler;
  ctx.webServer = {
    register: (route) => {
      handler = route.handler;
      return () => {};
    },
  };
  return { ctx, handler: (req, res) => handler(req, res) };
}

function call(handler, method, route, body) {
  const payload = body === undefined ? "" : JSON.stringify(body);
  const req = Readable.from(payload === "" ? [] : [Buffer.from(payload)]);
  req.method = method;
  req.url = `/dsh-toolset/api${route}`;
  const res = {
    status: 0,
    headers: undefined,
    body: undefined,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(text) {
      this.body = text === undefined ? undefined : JSON.parse(text);
    },
  };
  return handler(req, res).then(() => res);
}

const engine = {
  select: (target, benchId) => ({ benchId, name: "办公", started: false }),
};

test("GET /state reports the configuration the editor needs", async () => {
  const { service } = createService([{ name: "办公", description: "矩阵" }]);
  const { ctx, handler } = fakeCtx();
  registerWorkbenchHttp(ctx, { engine, service });

  const res = await call(handler, "GET", "/state");
  assert.equal(res.status, 200);
  assert.equal(res.body.benches[0].description, "矩阵");
  assert.deepEqual(res.body.toolOrder, []);
  assert.equal(res.body.degraded, false);
  assert.match(res.body.file, /workbenches\.json$/);
});

test("GET /tools describes every restrictable tool and its guessed origin", async () => {
  const { service } = createService();
  const { ctx, handler } = fakeCtx();
  registerWorkbenchHttp(ctx, { engine, service });

  const res = await call(handler, "GET", "/tools");
  assert.equal(res.status, 200);
  const byName = new Map(res.body.tools.map((tool) => [tool.name, tool]));
  assert.equal(byName.get("read").source.kind, "builtin");
  assert.equal(byName.get("read").description, "read a file");
  assert.equal(byName.get("univer_execute").source.kind, "plugin");
  assert.equal(byName.get("univer_execute").source.label, "univer");
  assert.equal(byName.get("mcp__zen-status__set_status").source.kind, "mcp");
  assert.equal(byName.get("mcp__zen-status__set_status").source.label, "zen-status");
});

test("POST /bench creates a workbench with its description", async () => {
  const { service } = createService();
  const { ctx, handler } = fakeCtx();
  registerWorkbenchHttp(ctx, { engine, service });

  const res = await call(handler, "POST", "/bench", { name: "办公", description: "矩阵" });
  assert.equal(res.status, 200);
  assert.equal(res.body.benches.length, 1);
  assert.equal(res.body.benches[0].description, "矩阵");
});

test("a malformed tool list is rejected instead of clearing the workbench", async () => {
  const { service } = createService([{ name: "办公" }]);
  const { ctx, handler } = fakeCtx();
  registerWorkbenchHttp(ctx, { engine, service });
  const id = service.list().benches[0].id;
  service.setTools("bench", id, ["grep"]);

  const res = await call(handler, "POST", "/bench/tools", { id, tools: "grep" });
  assert.equal(res.status, 400);
  assert.match(res.body.error.message, /必须是字符串数组/);
  assert.deepEqual(service.list().benches[0].tools, ["grep"]);
});

test("reorder routes reject partial lists and accept full ones", async () => {
  const { service } = createService([{ name: "A" }, { name: "B" }]);
  const { ctx, handler } = fakeCtx();
  registerWorkbenchHttp(ctx, { engine, service });
  const [a, b] = service.list().benches.map((bench) => bench.id);

  const partial = await call(handler, "POST", "/bench/reorder", { ids: [b] });
  assert.equal(partial.status, 400);
  assert.match(partial.body.error.message, /全部工作台/);

  const ok = await call(handler, "POST", "/bench/reorder", { ids: [b, a] });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.benches.map((bench) => bench.id), [b, a]);

  const tools = await call(handler, "POST", "/tools/reorder", { names: ["grep", "read", "grep"] });
  assert.equal(tools.status, 200);
  assert.deepEqual(tools.body.toolOrder, ["grep", "read"]);
});

test("POST /select needs a live conversation and a string bench id", async () => {
  const { service } = createService();
  const { ctx, handler } = fakeCtx();
  registerWorkbenchHttp(ctx, { engine, service });

  const missing = await call(handler, "POST", "/select", { sessionId: "nope" });
  assert.equal(missing.status, 400);
  assert.match(missing.body.error.message, /no live conversation/);

  const bad = await call(handler, "POST", "/select", { sessionId: agent.id, benchId: 42 });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error.message, /benchId 必须是字符串/);

  const ok = await call(handler, "POST", "/select", { sessionId: agent.id, benchId: null });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.benchId, null);
});

test("a degraded store refuses writes with 409", async () => {
  const { service, store } = createService();
  store.degraded = true;
  const { ctx, handler } = fakeCtx();
  registerWorkbenchHttp(ctx, { engine, service });

  const blocked = await call(handler, "POST", "/bench", { name: "办公" });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error.code, "read-only");

  const reads = await call(handler, "GET", "/state");
  assert.equal(reads.status, 200);
  assert.equal(reads.body.readOnly, true);
});

test("unknown routes answer 404 and wrong methods 405", async () => {
  const { service } = createService();
  const { ctx, handler } = fakeCtx();
  registerWorkbenchHttp(ctx, { engine, service });

  const unknown = await call(handler, "POST", "/nope", {});
  assert.equal(unknown.status, 404);
  assert.match(unknown.body.error.message, /unknown route/);

  const wrongMethod = await call(handler, "DELETE", "/state");
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.body.error.code, "method-not-allowed");
});

test("a rejected cross-site request never reaches the routes", async () => {
  const { service } = createService();
  const { ctx, handler } = fakeCtx({
    connection: { requestRejection: () => ({ reason: "origin" }) },
  });
  registerWorkbenchHttp(ctx, { engine, service });

  const res = await call(handler, "GET", "/state");
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, "forbidden");
});
