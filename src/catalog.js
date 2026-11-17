import { REQUEST_TOOL } from "./core.js";

const MAX_PURPOSE = 80;

/** First sentence of a tool description, flattened and truncated. */
export function firstSentence(description) {
  if (typeof description !== "string") return "";
  const flat = description.replace(/\s+/g, " ").trim();
  if (flat === "") return "";
  const cut = flat.search(/[。．.；;!?！？]/);
  const sentence = cut > 0 ? flat.slice(0, cut) : flat;
  return sentence.length > MAX_PURPOSE ? `${sentence.slice(0, MAX_PURPOSE)}…` : sentence;
}

function ownerLabel(service, name) {
  const owner = service.ownerOf(name);
  if (owner.kind === "global") return "全局";
  if (owner.kind === "bench") return `工作台「${owner.name}」`;
  return "未分类";
}

/**
 * Build the catalog section: the name and one-line purpose of every installed
 * tool that this conversation cannot use.
 */
export function buildCatalog(ctx, service, engine, context) {
  const agent = context?.agent;
  if (!agent) return "";
  const state = engine.stateFor(agent.id);
  const view = ctx.tools.view(agent);
  const visible = context?.toolSet ? context.toolSet.view(context.agent) : view.visible;
  const unavailable = [...view.knownNames].filter((name) => !visible.has(name)).sort();
  if (unavailable.length === 0) return "";

  const label = state?.name ? `「${state.name}」` : "无工作台";
  const lines = [
    "## 其他已安装的工具",
    `当前工作台：${label}。下列工具已安装但本对话不可用；确实需要时，调用 \`${REQUEST_TOOL}\` 申请一次授权，用户同意后本轮内可以直接使用。`,
  ];
  for (const name of unavailable) {
    const definition = state?.defs?.get(name) ?? ctx.tools.get(name);
    const purpose = firstSentence(definition?.description);
    lines.push(`- ${name}${purpose ? `：${purpose}` : ""}（${ownerLabel(service, name)}）`);
  }
  return lines.join("\n");
}

/**
 * Register the catalog as a late system-prompt section.
 * @returns the section disposer.
 */
export function registerCatalog(ctx, service, engine) {
  return ctx.systemPrompt.section({
    name: "workbench:catalog",
    order: 9000,
    text: (context) => buildCatalog(ctx, service, engine, context),
  });
}
