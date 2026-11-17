import { CORE_TOOLS, REQUEST_TOOL } from "./core.js";

const MAX_BODY = 64 * 1024;

/** Tools DSH itself ships, which no plugin can claim. */
const BUILTIN_TOOLS = new Set([...CORE_TOOLS, REQUEST_TOOL, "web_search", "web_fetch"]);

/**
 * Best-effort origin of one tool. The tool registry exposes no owner metadata
 * (`{ definition, when }` only), so this reads what the name encodes: MCP tools
 * are `mcp__<server>__<rawName>`, DSH's own tools are known by name, and plugin
 * tools are named after the plugin that ships them (`univer_execute`).
 */
function toolSource(name) {
  if (name.startsWith("mcp__")) {
    const rest = name.slice("mcp__".length);
    const cut = rest.indexOf("__");
    return { kind: "mcp", label: cut === -1 ? rest : rest.slice(0, cut) };
  }
  if (BUILTIN_TOOLS.has(name)) return { kind: "builtin", label: "" };
  const parts = name.split("_").filter((part) => part !== "");
  const token = parts[0] === "dsh" && parts.length > 1 ? parts[1] : parts[0];
  return token === undefined ? { kind: "plugin", label: name } : { kind: "plugin", label: token };
}

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

function requireString(value, field) {
  if (typeof value !== "string") throw new Error(`${field} 必须是字符串`);
  return value;
}

function optionalString(value, field) {
  if (value === undefined) return undefined;
  return requireString(value, field);
}

/**
 * Validates a list of names. A non-array must not be coerced to `[]`: that
 * would turn a malformed request into "clear every tool" instead of an error.
 */
function requireStrings(value, field) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${field} 必须是字符串数组`);
  }
  return value;
}

function editorState(service) {
  const config = service.list();
  return {
    version: config.version,
    global: config.global?.tools ?? [],
    benches: config.benches,
    lastSelected: config.lastSelected ?? null,
    toolOrder: config.toolOrder ?? [],
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
      source: toolSource(name),
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
          const benchId = body.benchId === undefined || body.benchId === null ? null : requireString(body.benchId, "benchId");
          const state = engine.select(agent, benchId);
          send(res, 200, { benchId: state.benchId, name: state.name, started: state.started });
          return;
        }
        if (route === "/bench") {
          service.create(requireString(body.name ?? "", "name"), optionalString(body.description, "description") ?? "");
          send(res, 200, editorState(service));
          return;
        }
        if (route === "/bench/update") {
          service.update(body.id, {
            name: optionalString(body.name, "name"),
            description: optionalString(body.description, "description"),
          });
          send(res, 200, editorState(service));
          return;
        }
        if (route === "/bench/remove") {
          service.remove(requireString(body.id, "id"));
          send(res, 200, editorState(service));
          return;
        }
        if (route === "/bench/reorder") {
          service.reorderBenches(requireStrings(body.ids, "ids"));
          send(res, 200, editorState(service));
          return;
        }
        if (route === "/bench/tools") {
          service.setTools("bench", requireString(body.id, "id"), requireStrings(body.tools, "tools"));
          send(res, 200, editorState(service));
          return;
        }
        if (route === "/global") {
          service.setTools("global", null, requireStrings(body.tools, "tools"));
          send(res, 200, editorState(service));
          return;
        }
        if (route === "/tools/reorder") {
          service.reorderTools(requireStrings(body.names, "names"));
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
