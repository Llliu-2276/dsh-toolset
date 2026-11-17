const MAX_BODY = 64 * 1024;

function send(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error("request body is too large");
    chunks.push(chunk);
  }
  if (size === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function strings(value) {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item) => typeof item === "string");
}

function editorState(service) {
  const config = service.list();
  return {
    version: config.version,
    global: config.global?.tools ?? [],
    benches: config.benches,
    lastSelected: config.lastSelected ?? null,
    degraded: config.degraded === true,
    readOnly: service.readOnly === true,
    file: config.file,
    error: config.error ?? null,
  };
}

/**
 * Every tool this host has installed, as seen through the agents' views.
 * The plugin's own context only sees its own layer, so the union over agents
 * is what a settings page should offer.
 */
function toolCatalog(ctx) {
  const names = new Map();
  for (const agent of ctx.agents.list()) {
    const view = ctx.tools.view(agent);
    for (const name of view.restrictableNames) {
      if (!names.has(name)) names.set(name, "");
    }
    for (const [name, registration] of view.registrations) {
      if (names.get(name) !== "") continue;
      names.set(name, registration.definition?.description ?? "");
    }
  }
  const global = ctx.tools.view();
  for (const name of global.knownNames) if (!names.has(name)) names.set(name, "");
  return [...names.entries()]
    .map(([name, description]) => ({
      name,
      description: description === "" ? (ctx.tools.get(name)?.description ?? "") : description,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function agentOf(ctx, sessionId) {
  if (typeof sessionId !== "string" || sessionId === "") throw new Error("sessionId is required");
  const agent = ctx.agents.get(sessionId);
  if (!agent) throw new Error(`no live conversation ${sessionId}`);
  return agent;
}

/**
 * Register the JSON API the browser half uses for the picker and the settings
 * page. Routes live under `/dsh-toolset/api` and are fenced by the host's own
 * browser trust check, exactly like any other in-app route.
 * @param ctx - plugin context (must expose `webServer` and `connection`).
 * @param options - `{ engine, service }`.
 * @returns the route disposer.
 */
export function registerWorkbenchHttp(ctx, { engine, service }) {
  return ctx.webServer.register({
    kind: "prefix",
    path: "/dsh-toolset/api",
    handler: async (req, res) => {
      if (ctx.connection.requestRejection(req) !== undefined) {
        send(res, 403, { error: { code: "forbidden", message: "forbidden" } });
        return;
      }
      const pathname = new URL(req.url ?? "/", "http://dsh.internal").pathname;
      const route = pathname.slice("/dsh-toolset/api".length) || "/";
      try {
        if (req.method === "GET" && route === "/state") {
          send(res, 200, editorState(service));
          return;
        }
        if (req.method === "GET" && route === "/tools") {
          send(res, 200, { tools: toolCatalog(ctx) });
          return;
        }
        if (req.method !== "POST") {
          send(res, 405, { error: { code: "method-not-allowed", message: `${req.method} is not supported` } });
          return;
        }
        const body = await readJson(req);
        if (service.readOnly) {
          send(res, 409, {
            error: { code: "read-only", message: "the workbench file is unreadable; fix it before editing" },
          });
          return;
        }
        if (route === "/select") {
          const agent = agentOf(ctx, body.sessionId);
          const state = engine.select(agent, body.benchId ?? null);
          send(res, 200, { benchId: state.benchId, name: state.name, started: state.started });
          return;
        }
        if (route === "/bench") {
          const name = typeof body.name === "string" ? body.name : "";
          service.create(name);
          send(res, 200, editorState(service));
          return;
        }
        if (route === "/bench/rename") {
          service.rename(body.id, body.name);
          send(res, 200, editorState(service));
          return;
        }
        if (route === "/bench/remove") {
          service.remove(body.id);
          send(res, 200, editorState(service));
          return;
        }
        if (route === "/bench/tools") {
          service.setTools("bench", body.id, strings(body.tools) ?? []);
          send(res, 200, editorState(service));
          return;
        }
        if (route === "/global") {
          service.setTools("global", null, strings(body.tools) ?? []);
          send(res, 200, editorState(service));
          return;
        }
        if (route === "/tools/move-to-global") {
          service.moveToGlobal(strings(body.tools) ?? []);
          send(res, 200, editorState(service));
          return;
        }
        send(res, 404, { error: { code: "not-found", message: `unknown route ${route}` } });
      } catch (error) {
        send(res, 400, { error: { code: "invalid", message: error?.message ?? String(error) } });
      }
    },
  });
}
