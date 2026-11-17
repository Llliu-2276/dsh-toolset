/**
 * `/workbench` — inspect or pick the workbench of the current conversation.
 * The picker UI in the composer uses the same engine call.
 */
export function registerWorkbenchCommand(ctx, { engine, service }) {
  return ctx.commands.register({
    definitionId: "dsh-toolset",
    name: "workbench",
    description: "查看或切换当前对话的工作台",
    input: { hint: "<名称或 id>" },
    handler: ({ agent, rawInput }) => {
      const state = engine.stateFor(agent.id) ?? engine.attach(agent);
      const config = service.list();
      const input = typeof rawInput === "string" ? rawInput.trim() : "";

      if (input === "") {
        const lines = [
          `当前工作台：${state.name ?? "无工作台"}${state.started ? "（已开始，不能更换）" : ""}`,
        ];
        if (config.benches.length === 0) {
          lines.push("还没有工作台，去 设置 → 工作台 里新建。");
        } else {
          for (const bench of config.benches) {
            const mark = bench.id === state.benchId ? " ←" : "";
            lines.push(`- ${bench.name}（${bench.tools.length} 个工具）${mark}`);
          }
        }
        if (config.degraded) lines.push(`⚠ 配置损坏，当前不做工具隔离：${config.error}`);
        return { kind: "success", text: lines.join("\n") };
      }

      const bench = config.benches.find((item) => item.name === input || item.id === input);
      if (!bench) return { kind: "error", text: `没有叫「${input}」的工作台` };
      try {
        engine.select(agent, bench.id);
      } catch (error) {
        return { kind: "error", text: error.message };
      }
      return { kind: "success", text: `工作台：${bench.name}（${bench.tools.length} 个工具）` };
    },
  });
}
