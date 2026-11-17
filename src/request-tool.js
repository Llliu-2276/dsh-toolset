import { REQUEST_TOOL } from "./core.js";

const PARAMETERS = {
  type: "object",
  properties: {
    tool: { type: "string", description: "要申请的工具名，必须与目录中列出的名字完全一致" },
    reason: { type: "string", description: "为什么需要这个工具，一句话，会展示给用户" },
  },
  required: ["tool"],
  additionalProperties: false,
};

/**
 * Register `request_tool`: ask the user for a one-turn grant on a tool that is
 * installed but outside the current workbench.
 * @returns the tool disposer.
 */
export function registerRequestTool(ctx, { engine, log }) {
  return ctx.tools.register({
    name: REQUEST_TOOL,
    description:
      "为当前对话申请临时使用一个不在工作台里的工具。只在确实需要时调用；用户同意后，本轮内可以直接调用该工具。",
    parameters: PARAMETERS,
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: String(value) }],
    },
    async execute(args, exec) {
      const agent = exec.agent;
      const name = typeof args?.tool === "string" ? args.tool.trim() : "";
      const reason = typeof args?.reason === "string" ? args.reason.trim() : "";
      if (name === "") return "没有指定工具名。";

      const view = ctx.tools.view(agent);
      if (!view.knownNames.has(name)) {
        return `没有名为「${name}」的工具；请只申请目录里列出的工具。`;
      }
      if (view.visible.has(name)) {
        return `「${name}」已经可以直接调用，不需要申请。`;
      }

      let outcome;
      try {
        outcome = await ctx.approval.request({
          agent,
          toolName: name,
          reason: reason || undefined,
          displayReason: `允许本次对话临时使用工具「${name}」${reason ? `：${reason}` : ""}`,
        });
      } catch (error) {
        log?.warn?.(`approval request failed: ${error.message}`);
        return `申请「${name}」失败：${error.message}`;
      }

      if (outcome !== "allowed-once") {
        return `用户没有批准使用「${name}」，本轮不要再次申请。`;
      }
      if (!engine.grant(agent.session.id, name)) {
        return "申请已批准，但当前对话没有加载工作台状态；请重试。";
      }
      return `已获准在本轮使用「${name}」，现在可以直接调用。`;
    },
  });
}
