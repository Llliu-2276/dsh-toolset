import { appendPluginRecord } from "@deepseek-ai/dsh-session";
import { configPath } from "./config.js";
import { createSessionRecorder } from "./session.js";
import { WorkbenchService } from "./service.js";
import { registerWorkbenchProjection } from "./projection.js";
import { MaskEngine } from "./mask.js";
import { registerCatalog } from "./catalog.js";
import { registerRequestTool } from "./request-tool.js";
import { registerWorkbenchCommand } from "./command.js";
import { registerWorkbenchHttp } from "./http.js";

export const name = "dsh-toolset";
export const inject = ["tools", "systemPrompt", "sessionProjections", "agents", "approval"];

/**
 * dsh-toolset: workbenches for DSH tools.
 *
 * A conversation freezes `CORE ∪ global ∪ bench` on its first turn and sees
 * nothing else; the full list of other tools stays visible as a short catalog
 * in the system prompt, and `request_tool` asks the user for a one-turn grant.
 */
export async function apply(ctx, config) {
  const log = ctx.logger("dsh-toolset");
  const service = new WorkbenchService(ctx, {
    file: config?.file ?? configPath(),
    logger: log,
  });
  const engine = new MaskEngine(ctx, service, log, createSessionRecorder(appendPluginRecord));

  const projection = await registerWorkbenchProjection(ctx, service);
  registerCatalog(ctx, service, engine);
  registerRequestTool(ctx, { engine, log });

  ctx.inject(["commands"], (scope) => registerWorkbenchCommand(scope, { engine, service }));

  // The browser half (picker and settings page) is served by the web profile
  // only; headless profiles have no webServer and simply skip this line.
  ctx.inject(["webServer", "connection"], (scope) =>
    scope.effect(() => registerWorkbenchHttp(scope, { engine, service }), "dsh-toolset: /dsh-toolset/api"),
  );

  ctx.on("agent/created", ({ agent }) => {
    engine.attach(agent);
  });
  ctx.on("session/event", (session, event) => {
    engine.onSessionEvent(session, event);
  });

  for (const agent of ctx.agents.list()) engine.attach(agent);

  ctx.on("dispose", () => {
    engine.dispose();
    projection?.dispose?.();
  });

  log.info(`ready (${service.file})`);

}
