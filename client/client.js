/**
 * Browser half of dsh-toolset: the composer pill, the session-header tag and
 * the settings page. Hand-written module — no bundler, no TypeScript. Only the
 * baseline modules the web app offers to plugins (`react`) may be required.
 *
 * Theme: everything is painted with the host's `--dsw-alias-*` tokens, which
 * switch with `<body data-ds-dark-theme>`; no colour is hard-coded here.
 */
window.__ModuleLoader__.load({
  id: "dsh-toolset",
  factory(require) {
    const React = require("react");
    const h = React.createElement;
    const { useCallback, useEffect, useMemo, useRef, useState } = React;

    const API = "/dsh-toolset/api";
    const NS = "dsh-toolset";

    /* ------------------------------------------------------------------ */
    /* copy                                                                */
    /* ------------------------------------------------------------------ */

    const TEXT = {
      zh: {
        "pill.none": "无工作台",
        "pill.title": "工作台：{name}",
        "pill.frozenTitle": "工作台：{name}（已冻结）",
        "menu.coreOnly": "只有核心工具",
        "menu.noBenches": "还没有工作台，去设置里新建。",
        "menu.frozen": "对话已经开始，工作台不能再换；新对话可以重新选。",
        "menu.toolCount": "{count} 个工具",
        "tag.label": "工作台：{name}",
        "tag.count": " · {count} 个工具",
        "tag.frozenTitle": "本对话冻结在「{name}」，共 {count} 个工具",
        "tag.plannedTitle": "本对话将使用「{name}」",
        "nav": "工作台",
        "title": "工作台",
        "intro":
          "每个对话在第一条消息发出时冻结一组工具；其余已安装工具只以「名字 + 一句话用途」出现在系统提示里，需要时由模型申请、你批准后临时放行。修改只影响新对话。",
        "degraded": "配置文件损坏，已停止写入并暂时不做工具隔离：{error}（文件：{file}）",
        "loading": "正在读取工作台配置…",
        "board.title": "工作台",
        "board.hint": "点卡片切换当前编辑的工作台；拖动卡片可以调整顺序。",
        "board.add": "新建",
        "board.addTitle": "新建工作台",
        "board.editTitle": "修改工作台",
        "board.remove": "删除工作台",
        "board.confirmRemove": "确认删除",
        "board.noDescription": "未填写介绍",
        "board.selected": "正在编辑",
        "global.title": "全局工作台",
        "global.desc": "这里的工具永远可用，不随对话选择变化。",
        "form.name": "名称",
        "form.namePlaceholder": "例如：办公",
        "form.description": "介绍",
        "form.descriptionPlaceholder": "一句话说明这个工作台用来做什么",
        "form.create": "创建",
        "form.save": "保存",
        "form.cancel": "取消",
        "form.edit": "编辑",
        "empty": "还没有工作台。用右侧的「新建」加一个，再挑要发给对话的工具。",
        "tools.title": "工具",
        "tools.hint": "点工具卡片加入或移出当前工作台；拖动可以调整顺序。全局工作台里的工具不可再分配到普通工作台。",
        "tools.hintGlobal": "点工具卡片加入或移出全局工作台。",
        "tools.empty": "没有可用的工具。",
        "tools.count": "{count} 个工具",
        "tool.inGlobal": "已在全局",
        "tool.locked": "已在全局工作台，不能再放进普通工作台",
        "tool.descriptionEmpty": "没有介绍。",
        "source.builtin": "内置",
        "source.mcp": "MCP · {server}",
        "source.plugin": "插件 · {name}",
      },
      en: {
        "pill.none": "No workbench",
        "pill.title": "Workbench: {name}",
        "pill.frozenTitle": "Workbench: {name} (frozen)",
        "menu.coreOnly": "Core tools only",
        "menu.noBenches": "No workbenches yet — create one in Settings.",
        "menu.frozen": "This conversation has started, so its workbench is fixed. Start a new one to change it.",
        "menu.toolCount": "{count} tools",
        "tag.label": "Workbench: {name}",
        "tag.count": " · {count} tools",
        "tag.frozenTitle": "Frozen on \"{name}\" with {count} tools",
        "tag.plannedTitle": "This conversation will use \"{name}\"",
        "nav": "Workbench",
        "title": "Workbench",
        "intro":
          "Each conversation freezes its tools when the first message is sent. Every other installed tool is listed by name and one line of purpose in the system prompt; the model can ask for one, and you approve it for that turn. Edits apply to new conversations.",
        "degraded":
          "The configuration file is damaged. Writes are stopped and tool masking is off: {error} (file: {file})",
        "loading": "Reading workbench configuration…",
        "board.title": "Workbenches",
        "board.hint": "Click a card to edit that workbench; drag cards to reorder them.",
        "board.add": "New",
        "board.addTitle": "New workbench",
        "board.editTitle": "Edit workbench",
        "board.remove": "Delete workbench",
        "board.confirmRemove": "Confirm",
        "board.noDescription": "No description",
        "board.selected": "Editing",
        "global.title": "Global",
        "global.desc": "These tools are always available and never change with the conversation.",
        "form.name": "Name",
        "form.namePlaceholder": "e.g. Office",
        "form.description": "Description",
        "form.descriptionPlaceholder": "One line about what this workbench is for",
        "form.create": "Create",
        "form.save": "Save",
        "form.cancel": "Cancel",
        "form.edit": "Edit",
        "empty": "No workbenches yet. Use New on the right, then pick the tools a conversation should carry.",
        "tools.title": "Tools",
        "tools.hint": "Click a tool card to add or remove it from the workbench being edited; drag to reorder. Tools in the global workbench cannot be assigned to a regular one.",
        "tools.hintGlobal": "Click a tool card to add or remove it from the global workbench.",
        "tools.empty": "No tools available.",
        "tools.count": "{count} tools",
        "tool.inGlobal": "Global",
        "tool.locked": "In the global workbench, so it cannot join a regular one",
        "tool.descriptionEmpty": "No description.",
        "source.builtin": "Built-in",
        "source.mcp": "MCP · {server}",
        "source.plugin": "Plugin · {name}",
      },
    };

    function langCode() {
      if (typeof document !== "undefined") {
        const lang = document.documentElement?.lang;
        if (typeof lang === "string" && lang !== "") return lang.toLowerCase().startsWith("zh") ? "zh" : "en";
      }
      if (typeof navigator !== "undefined" && typeof navigator.language === "string") {
        return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
      }
      return "en";
    }

    /** Copy for the current UI language; `{name}` placeholders are filled from `vars`. */
    function tr(key, vars) {
      const table = TEXT[langCode()] ?? TEXT.en;
      let text = table[key] ?? TEXT.en[key] ?? key;
      if (vars !== undefined) {
        for (const [name, value] of Object.entries(vars)) {
          text = text.split(`{${name}}`).join(String(value));
        }
      }
      return text;
    }

    /* ------------------------------------------------------------------ */
    /* styles                                                              */
    /* ------------------------------------------------------------------ */

    const CSS = `
.dswb-pill{display:inline-flex;align-items:center;gap:6px;height:28px;max-width:220px;padding:0 8px;
  border:none;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-secondary);
  font-size:13px;font-weight:500;line-height:20px;cursor:pointer;outline:none;font-family:inherit;}
.dswb-pill:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dswb-pill[disabled]{color:var(--dsw-alias-label-dimmed);cursor:default;}
.dswb-pill:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));}
.dswb-pillLabel{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.dswb-chevron{flex:none;display:inline-flex;transition:transform .12s;}
.dswb-chevron[data-open="true"]{transform:rotate(180deg);}
.dswb-menu{position:absolute;z-index:40;bottom:calc(100% + 6px);left:0;min-width:220px;max-height:320px;overflow:auto;
  padding:6px;border-radius:var(--dsw-radius-md,12px);border:1px solid var(--dsw-alias-border-l2);
  background:var(--dsw-menu-surface-fill,var(--dsw-alias-bg-layer-2));
  -webkit-backdrop-filter:var(--dsw-menu-backdrop-filter,none);backdrop-filter:var(--dsw-menu-backdrop-filter,none);
  box-shadow:var(--dsw-shadow-lv2,0 8px 28px rgba(0,0,0,.18));color:var(--dsw-alias-label-primary);}
.dswb-menuItem{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;padding:7px 9px;
  border:none;border-radius:var(--dsw-radius-xs,4px);background:transparent;color:inherit;font-size:13px;
  font-family:inherit;text-align:left;cursor:pointer;}
.dswb-menuItem:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dswb-menuItem[data-current="true"]{font-weight:600;color:var(--dsw-alias-label-primary);}
.dswb-menuItem[disabled]{color:var(--dsw-alias-label-dimmed);cursor:default;}
.dswb-menuMeta{color:var(--dsw-alias-label-tertiary);font-size:12px;}
.dswb-tag{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border-radius:999px;
  background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);
  font-size:12px;font-weight:500;white-space:nowrap;}
.dswb-tag[data-frozen="true"]{color:var(--dsw-alias-state-success-primary);}
.dswb-tagCount{opacity:.75;}
.dswb-page{display:flex;flex-direction:column;gap:18px;padding:4px 2px 28px;max-width:860px;color:var(--dsw-alias-label-primary);}
.dswb-title{font-size:15px;font-weight:600;margin:0;}
.dswb-sectionTitle{display:flex;align-items:baseline;gap:8px;margin:0;}
.dswb-desc{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12.5px;line-height:1.55;}
.dswb-banner{padding:9px 12px;border-radius:var(--dsw-radius-sm,8px);font-size:12.5px;line-height:1.5;
  background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-warn-primary);border:1px solid var(--dsw-alias-state-warn-primary);}
.dswb-row{display:flex;align-items:stretch;gap:10px;min-width:0;}
.dswb-boardScroll{display:flex;align-items:stretch;gap:10px;flex:1;min-width:0;overflow-x:auto;overflow-y:hidden;
  padding:2px 2px 8px;scrollbar-width:thin;}
.dswb-bench{position:relative;display:flex;flex-direction:column;gap:6px;flex:0 0 208px;min-height:96px;box-sizing:border-box;
  padding:11px 12px;border-radius:var(--dsw-radius-md,12px);border:1px solid var(--dsw-alias-border-l2);
  background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer;outline:none;
  text-align:left;font-family:inherit;transition:border-color .12s,background-color .12s;}
.dswb-bench:hover{border-color:var(--dsw-alias-border-l3);}
.dswb-bench[data-global="true"]{flex-basis:190px;background:var(--dsw-alias-bg-layer-1);}
.dswb-bench[data-selected="true"]{border-color:var(--dsw-alias-state-business-primary);
  background:var(--dsw-alias-bg-layer-3);}
.dswb-bench[data-dragging="true"]{opacity:.5;}
.dswb-bench[data-drop="true"]{box-shadow:inset 2px 0 0 var(--dsw-alias-state-business-primary);}
.dswb-bench:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));}
.dswb-benchHead{display:flex;align-items:center;gap:6px;padding-right:44px;}
.dswb-benchIcon{flex:none;display:inline-flex;color:var(--dsw-alias-label-secondary);}
.dswb-benchName{font-size:13.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.dswb-benchDesc{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary);
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.dswb-benchFoot{margin-top:auto;display:flex;align-items:center;gap:6px;
  font-size:11.5px;color:var(--dsw-alias-label-tertiary);}
.dswb-benchState{color:var(--dsw-alias-state-business-primary);font-weight:500;}
.dswb-benchActions{position:absolute;top:7px;right:7px;display:flex;align-items:center;gap:2px;}
.dswb-iconBtn{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;
  border:none;border-radius:var(--dsw-radius-xs,4px);background:transparent;color:var(--dsw-alias-label-tertiary);
  cursor:pointer;font-family:inherit;}
.dswb-iconBtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}
.dswb-iconBtn[data-danger="true"]:hover{color:var(--dsw-alias-state-error-primary);}
.dswb-add{flex:0 0 108px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;
  padding:10px;border-radius:var(--dsw-radius-md,12px);border:1px dashed var(--dsw-alias-border-l3);
  background:transparent;color:var(--dsw-alias-label-secondary);font-size:12.5px;font-family:inherit;cursor:pointer;}
.dswb-add:hover{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary);
  background:var(--dsw-alias-interactive-bg-hover);}
.dswb-add[disabled]{opacity:.5;cursor:default;}
.dswb-toolsBox{display:flex;flex-direction:column;gap:8px;padding:10px;border-radius:var(--dsw-radius-md,12px);
  border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);
  max-height:440px;overflow-y:auto;scrollbar-width:thin;}
.dswb-toolCard{display:flex;align-items:flex-start;gap:10px;padding:9px 11px;box-sizing:border-box;
  border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm,8px);
  background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);
  cursor:pointer;font-family:inherit;text-align:left;width:100%;outline:none;transition:border-color .12s,opacity .12s;}
.dswb-toolCard:hover{border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-3);}
.dswb-toolCard[data-selected="true"]{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary);}
.dswb-toolCard[data-locked="true"]{opacity:.45;cursor:default;}
.dswb-toolCard[data-dragging="true"]{opacity:.4;}
.dswb-toolCard[data-drop="true"]{box-shadow:inset 0 2px 0 var(--dsw-alias-state-business-primary);}
.dswb-toolCard:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));}
.dswb-grip{flex:none;display:inline-flex;align-items:center;padding-top:2px;color:var(--dsw-alias-label-dimmed);cursor:grab;}
.dswb-toolMain{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1;}
.dswb-toolName{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);}
.dswb-toolDesc{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary);
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.dswb-source{flex:none;display:inline-flex;align-items:center;height:18px;padding:0 7px;border-radius:999px;
  background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-tertiary);
  font-size:11px;font-weight:500;white-space:nowrap;border:1px solid var(--dsw-alias-border-l1);}
.dswb-check{flex:none;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;
  border-radius:50%;border:1px solid var(--dsw-alias-border-l3);color:transparent;}
.dswb-toolCard[data-selected="true"] .dswb-check{border-color:var(--dsw-alias-state-business-primary);
  background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-bg-base);}
.dswb-overlay{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;
  background:var(--dsw-alias-bg-mask-2,rgba(0,0,0,.35));}
.dswb-dialog{width:min(440px,calc(100vw - 48px));display:flex;flex-direction:column;gap:12px;padding:18px;
  border-radius:var(--dsw-radius-lg,16px);border:1px solid var(--dsw-alias-border-l2);
  background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-panel,0 16px 48px rgba(0,0,0,.24));}
.dswb-field{display:flex;flex-direction:column;gap:5px;}
.dswb-fieldLabel{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);}
.dswb-input{height:32px;padding:0 10px;font-size:13px;color:var(--dsw-alias-label-primary);font-family:inherit;
  border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm,8px);
  background:var(--dsw-alias-bg-base);outline:none;}
.dswb-input::placeholder{color:var(--dsw-alias-label-dimmed);}
.dswb-input:focus{border-color:var(--dsw-alias-state-business-primary);}
.dswb-textarea{min-height:64px;resize:vertical;padding:8px 10px;font-size:13px;line-height:1.5;
  color:var(--dsw-alias-label-primary);font-family:inherit;border:1px solid var(--dsw-alias-border-l2);
  border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-bg-base);outline:none;}
.dswb-textarea:focus{border-color:var(--dsw-alias-state-business-primary);}
.dswb-dialogFoot{display:flex;justify-content:flex-end;gap:8px;}
.dswb-btn{height:30px;padding:0 12px;font-size:12.5px;font-family:inherit;border-radius:var(--dsw-radius-sm,8px);
  cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);}
.dswb-btn:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dswb-btn[data-primary="true"]{border-color:var(--dsw-alias-state-business-primary);
  background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-inverted,#fff);}
.dswb-btn[disabled]{opacity:.5;cursor:default;}
.dswb-hint{font-size:12px;color:var(--dsw-alias-label-tertiary);}
.dswb-error{font-size:12.5px;color:var(--dsw-alias-state-error-primary);}
.dswb-empty{font-size:12.5px;color:var(--dsw-alias-label-tertiary);}
`;

    function ensureStyles() {
      if (typeof document === "undefined") return;
      const existing = document.querySelector(`style[data-plugin-css="${NS}"]`);
      if (existing !== null) {
        if (existing.textContent !== CSS) existing.textContent = CSS;
        return;
      }
      const tag = document.createElement("style");
      tag.dataset.plugin = NS;
      tag.dataset.pluginCss = NS;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    /* ------------------------------------------------------------------ */
    /* host API                                                            */
    /* ------------------------------------------------------------------ */

    async function api(path, body) {
      const init =
        body === undefined
          ? { method: "GET" }
          : {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            };
      const response = await fetch(`${API}${path}`, { credentials: "same-origin", ...init });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = payload?.error?.message ?? `HTTP ${response.status}`;
        throw new Error(message);
      }
      return payload;
    }

    /* ------------------------------------------------------------------ */
    /* icons                                                               */
    /* ------------------------------------------------------------------ */

    function svg(size, children) {
      return h(
        "svg",
        {
          viewBox: "0 0 24 24",
          width: size,
          height: size,
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.5,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": true,
        },
        children,
      );
    }

    /** Line-art Minecraft crafting table: studded top, 3x3 grid, tapered legs. */
    const CraftingTable = ({ size = 16 }) =>
      svg(size, [
        h("path", { key: "top", d: "M3.2 5.4h17.6v7.4H3.2z" }),
        h("path", { key: "v1", d: "M9.1 5.4v7.4" }),
        h("path", { key: "v2", d: "M14.9 5.4v7.4" }),
        h("path", { key: "h1", d: "M3.2 7.9h17.6" }),
        h("path", { key: "h2", d: "M3.2 10.3h17.6" }),
        h("path", { key: "leg1", d: "M5.6 12.8 4.4 18.6" }),
        h("path", { key: "leg2", d: "M18.4 12.8 19.6 18.6" }),
        h("path", { key: "rail", d: "M4.9 18.6h14.2" }),
      ]);

    const Chevron = ({ open }) =>
      h(
        "span",
        { className: "dswb-chevron", "data-open": open ? "true" : "false", "aria-hidden": true },
        h(
          "svg",
          { viewBox: "0 0 16 16", width: 12, height: 12, fill: "none" },
          h("path", {
            d: "M4 6.5 8 10.5 12 6.5",
            stroke: "currentColor",
            strokeWidth: 1.6,
            strokeLinecap: "round",
            strokeLinejoin: "round",
          }),
        ),
      );

    const Lock = () =>
      h(
        "span",
        { "aria-hidden": true, style: { display: "inline-flex" } },
        h(
          "svg",
          { viewBox: "0 0 16 16", width: 11, height: 11, fill: "none" },
          h("rect", { x: 3.2, y: 7, width: 9.6, height: 6.4, rx: 1.6, stroke: "currentColor", strokeWidth: 1.4 }),
          h("path", { d: "M5.4 7V5.3a2.6 2.6 0 0 1 5.2 0V7", stroke: "currentColor", strokeWidth: 1.4 }),
        ),
      );

    const Plus = ({ size = 18 }) => svg(size, [h("path", { key: "a", d: "M12 5v14" }), h("path", { key: "b", d: "M5 12h14" })]);

    const Pencil = ({ size = 13 }) =>
      svg(size, [
        h("path", { key: "a", d: "M4 20h4l9.5-9.5a2.1 2.1 0 0 0-3-3L5 17v3z" }),
        h("path", { key: "b", d: "M13.5 5.5 18 10" }),
      ]);

    const Trash = ({ size = 13 }) =>
      svg(size, [
        h("path", { key: "a", d: "M4 7h16" }),
        h("path", { key: "b", d: "M9 7V5.2h6V7" }),
        h("path", { key: "c", d: "M6.5 7 7.4 19h9.2L17.5 7" }),
        h("path", { key: "d", d: "M10.5 10.5v5M13.5 10.5v5" }),
      ]);

    const Grip = () =>
      h(
        "span",
        { className: "dswb-grip", "aria-hidden": true },
        h(
          "svg",
          { viewBox: "0 0 10 16", width: 10, height: 16, fill: "currentColor", stroke: "none" },
          [2, 5, 8, 11, 14].flatMap((y) => [
            h("circle", { key: `l${y}`, cx: 3, cy: y - 3.2, r: 1 }),
            h("circle", { key: `r${y}`, cx: 7, cy: y - 3.2, r: 1 }),
          ]),
        ),
      );

    const Check = () =>
      h(
        "span",
        { className: "dswb-check", "aria-hidden": true },
        h(
          "svg",
          { viewBox: "0 0 16 16", width: 11, height: 11, fill: "none" },
          h("path", {
            d: "M3.5 8.4 6.4 11.3 12.5 5",
            stroke: "currentColor",
            strokeWidth: 2,
            strokeLinecap: "round",
            strokeLinejoin: "round",
          }),
        ),
      );

    /* ------------------------------------------------------------------ */
    /* hooks                                                               */
    /* ------------------------------------------------------------------ */

    function useOutsideClose(ref, close, active) {
      useEffect(() => {
        if (!active || typeof document === "undefined") return undefined;
        const onPointer = (event) => {
          if (ref.current !== null && !ref.current.contains(event.target)) close();
        };
        const onKey = (event) => {
          if (event.key === "Escape") close();
        };
        document.addEventListener("mousedown", onPointer, true);
        document.addEventListener("keydown", onKey, true);
        return () => {
          document.removeEventListener("mousedown", onPointer, true);
          document.removeEventListener("keydown", onKey, true);
        };
      }, [active, close, ref]);
    }

    /** Workbench projection for this conversation, or undefined when the framework passes none. */
    function projectionOf(useProjection) {
      if (typeof useProjection !== "function") return undefined;
      try {
        return useProjection("workbench");
      } catch {
        return undefined;
      }
    }

    /* ------------------------------------------------------------------ */
    /* picker                                                              */
    /* ------------------------------------------------------------------ */

    function PickerView({ sessionId, useProjection }) {
      const projection = projectionOf(useProjection);
      const [open, setOpen] = useState(false);
      const [config, setConfig] = useState(null);
      const [error, setError] = useState(null);
      const [pending, setPending] = useState(false);
      const rootRef = useRef(null);
      const close = useCallback(() => setOpen(false), []);
      useOutsideClose(rootRef, close, open);

      const frozen = projection?.started === true;
      const label = projection?.name ?? tr("pill.none");

      useEffect(() => {
        if (!open) return undefined;
        let cancelled = false;
        api("/state")
          .then((next) => {
            if (cancelled) return;
            setConfig(next);
            setError(null);
          })
          .catch((cause) => {
            if (!cancelled) setError(cause.message);
          });
        return () => {
          cancelled = true;
        };
      }, [open]);

      const pick = (benchId) => {
        if (typeof sessionId !== "string" || sessionId === "") {
          setError("session unknown");
          return;
        }
        setPending(true);
        api("/select", { sessionId, benchId })
          .then(() => {
            setOpen(false);
            setError(null);
          })
          .catch((cause) => setError(cause.message))
          .finally(() => setPending(false));
      };

      const benches = config?.benches ?? [];
      const menu = open
        ? h(
            "div",
            { className: "dswb-menu", role: "menu" },
            h(
              "button",
              {
                type: "button",
                className: "dswb-menuItem",
                role: "menuitem",
                "data-current": projection?.benchId == null ? "true" : "false",
                disabled: frozen || pending,
                onClick: () => pick(null),
              },
              h("span", null, tr("pill.none")),
              h("span", { className: "dswb-menuMeta" }, tr("menu.coreOnly")),
            ),
            h("div", { style: { height: 1, margin: "4px 2px", background: "var(--dsw-alias-border-l1)" } }),
            benches.length === 0
              ? h("div", { className: "dswb-empty", style: { padding: "7px 9px" } }, tr("menu.noBenches"))
              : benches.map((bench) =>
                  h(
                    "button",
                    {
                      key: bench.id,
                      type: "button",
                      className: "dswb-menuItem",
                      role: "menuitem",
                      "data-current": bench.id === projection?.benchId ? "true" : "false",
                      disabled: frozen || pending,
                      onClick: () => pick(bench.id),
                    },
                    h("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, bench.name),
                    h("span", { className: "dswb-menuMeta" }, tr("menu.toolCount", { count: bench.tools.length })),
                  ),
                ),
            frozen ? h("div", { className: "dswb-hint", style: { padding: "8px 9px 4px" } }, tr("menu.frozen")) : null,
            error !== null ? h("div", { className: "dswb-error", style: { padding: "6px 9px" } }, error) : null,
          )
        : null;

      return h(
        "div",
        { ref: rootRef, style: { position: "relative", display: "inline-flex" } },
        h(
          "button",
          {
            type: "button",
            className: "dswb-pill",
            title: frozen ? tr("pill.frozenTitle", { name: label }) : tr("pill.title", { name: label }),
            "aria-haspopup": "menu",
            "aria-expanded": open ? "true" : "false",
            onClick: () => setOpen((value) => !value),
          },
          frozen ? h(Lock) : h(CraftingTable, { size: 14 }),
          h("span", { className: "dswb-pillLabel" }, label),
          h(Chevron, { open }),
        ),
        menu,
      );
    }

    function Picker(props) {
      return typeof props?.useProjection === "function" ? h(PickerView, props) : null;
    }

    /* ------------------------------------------------------------------ */
    /* header tag                                                          */
    /* ------------------------------------------------------------------ */

    function HeaderTagView({ useProjection }) {
      const projection = projectionOf(useProjection);
      if (projection === undefined) return null;
      const label = projection.name ?? tr("pill.none");
      const frozen = projection.started === true;
      const count = frozen
        ? (projection.allowed?.length ||
          (projection.core?.length ?? 0) + (projection.global?.length ?? 0) + (projection.bench?.length ?? 0))
        : 0;
      return h(
        "span",
        {
          className: "dswb-tag",
          "data-frozen": frozen ? "true" : "false",
          title: frozen ? tr("tag.frozenTitle", { name: label, count }) : tr("tag.plannedTitle", { name: label }),
        },
        frozen ? h(Lock) : h(CraftingTable, { size: 12 }),
        h("span", null, tr("tag.label", { name: label })),
        frozen ? h("span", { className: "dswb-tagCount" }, tr("tag.count", { count })) : null,
      );
    }

    function HeaderTag(props) {
      return typeof props?.useProjection === "function" ? h(HeaderTagView, props) : null;
    }

    /* ------------------------------------------------------------------ */
    /* settings page                                                       */
    /* ------------------------------------------------------------------ */

    /** Insert `moved` at the index of `target` inside `list` (a plain reorder). */
    function reorder(list, moved, target) {
      if (moved === target) return list;
      const without = list.filter((item) => item !== moved);
      const at = without.indexOf(target);
      if (at === -1) return list;
      return [...without.slice(0, at), moved, ...without.slice(at)];
    }

    function BenchDialog({ mode, initial, busy, onCancel, onSubmit }) {
      const [name, setName] = useState(initial?.name ?? "");
      const [description, setDescription] = useState(initial?.description ?? "");
      const nameRef = useRef(null);
      useEffect(() => {
        nameRef.current?.focus();
        nameRef.current?.select();
      }, []);
      useEffect(() => {
        const onKey = (event) => {
          if (event.key === "Escape") onCancel();
        };
        document.addEventListener("keydown", onKey, true);
        return () => document.removeEventListener("keydown", onKey, true);
      }, [onCancel]);
      const submit = () => {
        const trimmed = name.trim();
        if (trimmed === "") return;
        onSubmit({ name: trimmed, description: description.trim() });
      };
      return h(
        "div",
        { className: "dswb-overlay", role: "presentation", onMouseDown: (event) => event.stopPropagation() },
        h(
          "div",
          { className: "dswb-dialog", role: "dialog", "aria-modal": "true" },
          h("h2", { className: "dswb-title" }, mode === "edit" ? tr("board.editTitle") : tr("board.addTitle")),
          h(
            "label",
            { className: "dswb-field" },
            h("span", { className: "dswb-fieldLabel" }, tr("form.name")),
            h("input", {
              ref: nameRef,
              className: "dswb-input",
              value: name,
              maxLength: 30,
              placeholder: tr("form.namePlaceholder"),
              disabled: busy,
              onChange: (event) => setName(event.target.value),
              onKeyDown: (event) => {
                if (event.key === "Enter") submit();
              },
            }),
          ),
          h(
            "label",
            { className: "dswb-field" },
            h("span", { className: "dswb-fieldLabel" }, tr("form.description")),
            h("textarea", {
              className: "dswb-textarea",
              value: description,
              maxLength: 200,
              placeholder: tr("form.descriptionPlaceholder"),
              disabled: busy,
              onChange: (event) => setDescription(event.target.value),
            }),
          ),
          h(
            "div",
            { className: "dswb-dialogFoot" },
            h("button", { type: "button", className: "dswb-btn", disabled: busy, onClick: onCancel }, tr("form.cancel")),
            h(
              "button",
              {
                type: "button",
                className: "dswb-btn",
                "data-primary": "true",
                disabled: busy || name.trim() === "",
                onClick: submit,
              },
              mode === "edit" ? tr("form.save") : tr("form.create"),
            ),
          ),
        ),
      );
    }

    function BenchCard({ bench, global, selected, busy, dragging, onSelect, onEdit, onRemove, onDragStart, onDropIn }) {
      const [confirming, setConfirming] = useState(false);
      useEffect(() => {
        if (!confirming) return undefined;
        const timer = setTimeout(() => setConfirming(false), 4000);
        return () => clearTimeout(timer);
      }, [confirming]);
      const title = global ? tr("global.title") : bench.name;
      const description = global ? tr("global.desc") : bench.description || tr("board.noDescription");
      return h(
        "div",
        {
          className: "dswb-bench",
          role: "button",
          tabIndex: 0,
          "data-global": global ? "true" : "false",
          "data-selected": selected ? "true" : "false",
          "data-dragging": dragging ? "true" : "false",
          draggable: global || busy ? "false" : "true",
          "aria-pressed": selected ? "true" : "false",
          title: global ? tr("global.desc") : description,
          onClick: onSelect,
          onKeyDown: (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelect();
            }
          },
          onDragStart: (event) => {
            if (global || busy) return;
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", bench.id);
            onDragStart(bench.id);
          },
          onDragEnd: () => onDragStart(null),
          onDragOver: (event) => {
            if (global) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          },
          onDrop: (event) => {
            event.preventDefault();
            onDropIn(bench.id);
          },
        },
        global ? null : h("div", { className: "dswb-benchActions", onClick: (event) => event.stopPropagation() }, [
          h(
            "button",
            {
              key: "edit",
              type: "button",
              className: "dswb-iconBtn",
              title: tr("form.edit"),
              "aria-label": tr("form.edit"),
              disabled: busy,
              onClick: onEdit,
            },
            h(Pencil),
          ),
          h(
            "button",
            {
              key: "remove",
              type: "button",
              className: "dswb-iconBtn",
              "data-danger": confirming ? "true" : "false",
              title: tr("board.remove"),
              "aria-label": confirming ? tr("board.confirmRemove") : tr("board.remove"),
              disabled: busy,
              onClick: () => {
                if (!confirming) {
                  setConfirming(true);
                  return;
                }
                onRemove();
              },
            },
            confirming ? h(Trash, { size: 14 }) : h(Trash),
          ),
        ]),
        h(
          "div",
          { className: "dswb-benchHead" },
          h("span", { className: "dswb-benchIcon" }, h(CraftingTable, { size: 15 })),
          h("span", { className: "dswb-benchName" }, title),
        ),
        h("div", { className: "dswb-benchDesc" }, description),
        h(
          "div",
          { className: "dswb-benchFoot" },
          h("span", null, tr("tools.count", { count: bench.tools.length })),
          selected ? h("span", { className: "dswb-benchState" }, tr("board.selected")) : null,
        ),
      );
    }

    function ToolCard({ tool, selected, locked, global, busy, dragging, onToggle, onDragStart, onDropOn }) {
      const source =
        tool.source?.kind === "mcp"
          ? tr("source.mcp", { server: tool.source.label })
          : tool.source?.kind === "builtin"
            ? tr("source.builtin")
            : tool.source?.label
              ? tr("source.plugin", { name: tool.source.label })
              : "";
      return h(
        "div",
        {
          className: "dswb-toolCard",
          role: "button",
          tabIndex: 0,
          "data-selected": selected ? "true" : "false",
          "data-locked": locked ? "true" : "false",
          "data-dragging": dragging ? "true" : "false",
          draggable: busy ? "false" : "true",
          "aria-pressed": selected ? "true" : "false",
          title: locked ? tr("tool.locked") : tool.description || tool.name,
          onClick: () => {
            if (!locked && !busy) onToggle();
          },
          onKeyDown: (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              if (!locked && !busy) onToggle();
            }
          },
          onDragStart: (event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", tool.name);
            onDragStart(tool.name);
          },
          onDragEnd: () => onDragStart(null),
          onDragOver: (event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          },
          onDrop: (event) => {
            event.preventDefault();
            onDropOn(tool.name);
          },
        },
        h(Grip),
        h(
          "div",
          { className: "dswb-toolMain" },
          h(
            "div",
            { className: "dswb-toolName" },
            h("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, tool.name),
            source === "" ? null : h("span", { className: "dswb-source" }, source),
            locked ? h("span", { className: "dswb-source" }, tr("tool.inGlobal")) : null,
          ),
          h("div", { className: "dswb-toolDesc" }, tool.description || tr("tool.descriptionEmpty")),
        ),
        h(Check),
      );
    }

    function SettingsPage() {
      const [config, setConfig] = useState(null);
      const [tools, setTools] = useState([]);
      const [error, setError] = useState(null);
      const [busy, setBusy] = useState(false);
      const [dialog, setDialog] = useState(null);
      const [selectedId, setSelectedId] = useState(null);
      const [dragBench, setDragBench] = useState(null);
      const [dragTool, setDragTool] = useState(null);

      const load = useCallback(() => {
        Promise.all([api("/state"), api("/tools")])
          .then(([state, catalog]) => {
            setConfig(state);
            setTools(catalog.tools);
            setError(null);
          })
          .catch((cause) => setError(cause.message));
      }, []);

      useEffect(() => {
        ensureStyles();
        load();
      }, [load]);

      const mutate = useCallback((path, body) => {
        setBusy(true);
        api(path, body)
          .then((state) => {
            setConfig(state);
            setError(null);
          })
          .catch((cause) => setError(cause.message))
          .finally(() => setBusy(false));
      }, []);

      /* The global workbench is always first; a bench defaults to the last one used. */
      const benches = config?.benches ?? [];
      const selectedBench = selectedId === "global" ? null : (benches.find((bench) => bench.id === selectedId) ?? null);
      const editingGlobal = selectedId === "global";
      const activeId = editingGlobal ? "global" : (selectedBench?.id ?? null);

      useEffect(() => {
        if (config === null || activeId !== null) return;
        const fallback = config.benches.find((bench) => bench.id === config.lastSelected) ?? config.benches[0];
        setSelectedId(fallback === undefined ? "global" : fallback.id);
      }, [activeId, config]);

      const globalTools = useMemo(() => new Set(config?.global ?? []), [config]);
      const orderedTools = useMemo(() => {
        const order = config?.toolOrder ?? [];
        const rank = new Map(order.map((name, index) => [name, index]));
        return [...tools].sort((left, right) => {
          const a = rank.has(left.name) ? rank.get(left.name) : Number.MAX_SAFE_INTEGER;
          const b = rank.has(right.name) ? rank.get(right.name) : Number.MAX_SAFE_INTEGER;
          if (a !== b) return a - b;
          return left.name.localeCompare(right.name);
        });
      }, [config, tools]);

      if (config === null) {
        return h(
          "div",
          { className: "dswb-page" },
          error !== null ? h("div", { className: "dswb-error" }, error) : h("div", { className: "dswb-hint" }, tr("loading")),
        );
      }

      const disabled = busy || config.readOnly;
      const selectedTools = editingGlobal ? config.global : (selectedBench?.tools ?? []);
      const selectedSet = new Set(selectedTools);
      /* Inside a regular workbench, a tool that lives in the global one is locked. */
      const benchBlocksGlobal = selectedBench !== null;

      const toggleTool = (name) => {
        if (editingGlobal) {
          const next = config.global.includes(name)
            ? config.global.filter((item) => item !== name)
            : [...config.global, name];
          mutate("/global", { tools: next });
          return;
        }
        if (selectedBench === null) return;
        if (config.global.includes(name)) return;
        const next = selectedBench.tools.includes(name)
          ? selectedBench.tools.filter((item) => item !== name)
          : [...selectedBench.tools, name];
        mutate("/bench/tools", { id: selectedBench.id, tools: next });
      };

      const dropBench = (targetId) => {
        const moved = dragBench;
        setDragBench(null);
        if (moved === null || moved === targetId) return;
        const ids = reorder(benches.map((bench) => bench.id), moved, targetId);
        if (ids.join("|") === benches.map((bench) => bench.id).join("|")) return;
        mutate("/bench/reorder", { ids });
      };

      const dropTool = (targetName) => {
        const moved = dragTool;
        setDragTool(null);
        if (moved === null || moved === targetName) return;
        const names = reorder(orderedTools.map((tool) => tool.name), moved, targetName);
        mutate("/tools/reorder", { names });
      };

      const openCreate = () => setDialog({ mode: "create" });
      const closeDialog = () => setDialog(null);

      const submitDialog = (values) => {
        const target = dialog;
        closeDialog();
        if (target.mode === "edit" && target.bench !== undefined) {
          mutate("/bench/update", { id: target.bench.id, name: values.name, description: values.description });
          return;
        }
        setBusy(true);
        api("/bench", values)
          .then((state) => {
            setConfig(state);
            setError(null);
            const created = state.benches[state.benches.length - 1];
            if (created !== undefined) setSelectedId(created.id);
          })
          .catch((cause) => setError(cause.message))
          .finally(() => setBusy(false));
      };

      return h(
        "div",
        { className: "dswb-page" },
        h("h2", { className: "dswb-title" }, tr("title")),
        h("p", { className: "dswb-desc" }, tr("intro")),
        config.degraded ? h("div", { className: "dswb-banner" }, tr("degraded", { error: config.error ?? "unknown", file: config.file })) : null,
        error !== null ? h("div", { className: "dswb-error" }, error) : null,
        h(
          "section",
          { style: { display: "flex", flexDirection: "column", gap: 6 } },
          h("h3", { className: "dswb-sectionTitle dswb-title", style: { fontSize: 13 } }, tr("board.title")),
          h("p", { className: "dswb-desc" }, tr("board.hint")),
          h(
            "div",
            { className: "dswb-row" },
            h(
              "div",
              { className: "dswb-boardScroll" },
              h(BenchCard, {
                key: "global",
                bench: { id: "global", name: tr("global.title"), description: "", tools: config.global },
                global: true,
                selected: editingGlobal,
                busy: disabled,
                dragging: false,
                onSelect: () => setSelectedId("global"),
                onEdit: () => {},
                onRemove: () => {},
                onDragStart: () => {},
                onDropIn: () => {},
              }),
              benches.length === 0
                ? h("div", { className: "dswb-empty", style: { alignSelf: "center", padding: "0 6px" } }, tr("empty"))
                : benches.map((bench) =>
                    h(BenchCard, {
                      key: bench.id,
                      bench,
                      global: false,
                      selected: bench.id === selectedBench?.id,
                      busy: disabled,
                      dragging: dragBench === bench.id,
                      onSelect: () => setSelectedId(bench.id),
                      onEdit: () => setDialog({ mode: "edit", bench }),
                      onRemove: () => {
                        if (selectedBench?.id === bench.id) setSelectedId(null);
                        mutate("/bench/remove", { id: bench.id });
                      },
                      onDragStart: setDragBench,
                      onDropIn: dropBench,
                    }),
                  ),
            ),
            h(
              "button",
              { type: "button", className: "dswb-add", disabled: disabled, onClick: openCreate },
              h(Plus),
              h("span", null, tr("board.add")),
            ),
          ),
        ),
        h(
          "section",
          { style: { display: "flex", flexDirection: "column", gap: 6 } },
          h(
            "h3",
            { className: "dswb-sectionTitle dswb-title", style: { fontSize: 13 } },
            tr("tools.title"),
            h(
              "span",
              { className: "dswb-hint" },
              editingGlobal
                ? tr("tools.hintGlobal")
                : selectedBench === null
                  ? ""
                  : tr("tools.hint"),
            ),
          ),
          h(
            "div",
            { className: "dswb-toolsBox" },
            orderedTools.length === 0
              ? h("div", { className: "dswb-empty" }, tr("tools.empty"))
              : orderedTools.map((tool) =>
                  h(ToolCard, {
                    key: tool.name,
                    tool,
                    selected: selectedSet.has(tool.name),
                    locked: benchBlocksGlobal && !editingGlobal && globalTools.has(tool.name),
                    global: editingGlobal,
                    busy: disabled || (selectedBench === null && !editingGlobal),
                    dragging: dragTool === tool.name,
                    onToggle: () => toggleTool(tool.name),
                    onDragStart: setDragTool,
                    onDropOn: dropTool,
                  }),
                ),
          ),
        ),
        dialog === null
          ? null
          : h(BenchDialog, {
              mode: dialog.mode,
              initial: dialog.bench,
              busy,
              onCancel: closeDialog,
              onSubmit: submitDialog,
            }),
      );
    }

    /* ------------------------------------------------------------------ */
    /* plugin                                                              */
    /* ------------------------------------------------------------------ */

    return {
      inject: ["slots"],
      apply(ctx) {
        ensureStyles();

        ctx.slots.inject("conversation.input.right", () =>
          ctx.slots.register(
            {
              name: "conversation.input.right",
              id: `${NS}:picker`,
              order: 5,
              inject: (sessionId) => ({ sessionId }),
            },
            Picker,
          ),
        );

        ctx.slots.inject("conversation.session.header.actions", () =>
          ctx.slots.register(
            {
              name: "conversation.session.header.actions",
              id: `${NS}:tag`,
              order: 10,
              inject: (sessionId) => ({ sessionId }),
            },
            HeaderTag,
          ),
        );

        ctx.slots.inject("settings.section", () =>
          ctx.slots.register(
            {
              name: "settings.section",
              id: NS,
              order: 18,
              label: () => tr("nav"),
            },
            SettingsPage,
          ),
        );
      },
    };
  },
});
