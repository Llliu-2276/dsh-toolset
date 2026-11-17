/**
 * Browser half of dsh-toolset: the composer pill, the session-header tag and
 * the settings page. Hand-written module — no bundler, no TypeScript. Only the
 * baseline modules the web app offers to plugins (`react`) may be required.
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
          "每个对话在第一条消息发出时冻结一组工具；其余已安装工具只以「名字 + 一句话用途」出现在系统提示里，需要时由模型申请、你批准后临时放行。修改只影响新对话；同时归属全局工作台的工具不能再放进普通工作台。",
        "degraded":
          "配置文件损坏，已停止写入并暂时不做工具隔离：{error}（文件：{file}）",
        "loading": "正在读取工作台配置…",
        "create.title": "新建工作台",
        "create.placeholder": "例如：办公",
        "create.submit": "新建",
        "empty": "还没有工作台。新建一个，再把要发给对话的工具勾上。",
        "bench.name": "工作台名称",
        "bench.remove": "删除",
        "bench.confirmRemove": "确认删除",
        "bench.summary": "已选 {count} 个工具；不属于任何工作台的已安装工具默认不发送。",
        "bench.conflict": "这些工具同时在全局工作台里，不能重复分配：{tools}",
        "global.title": "全局工作台",
        "global.desc": "这里的工具永远可用，不随对话选择变化；一个工具不能同时在全局和普通工作台里。",
        "unclassified.title": "未分类",
        "unclassified.count": "已安装但不在任何工作台：{count} 个",
        "unclassified.empty": "所有已安装的工具都分配好了。",
        "unclassified.toGlobal": "把 {name} 放进全局工作台",
        "unclassified.hint": "默认不发送；点一下把它放进全局工作台，或在上面某个工作台里勾选。",
        "tools.empty": "没有可用的工具。",
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
          "Each conversation freezes its tools when the first message is sent. Every other installed tool is listed by name and one line of purpose in the system prompt; the model can ask for one, and you approve it for that turn. Edits apply to new conversations. A tool that belongs to the global workbench cannot be assigned to a regular one.",
        "degraded":
          "The configuration file is damaged. Writes are stopped and tool masking is off: {error} (file: {file})",
        "loading": "Reading workbench configuration…",
        "create.title": "New workbench",
        "create.placeholder": "e.g. Office",
        "create.submit": "Create",
        "empty": "No workbenches yet. Create one, then tick the tools a conversation should carry.",
        "bench.name": "Workbench name",
        "bench.remove": "Delete",
        "bench.confirmRemove": "Confirm",
        "bench.summary": "Selected {count} tools. Installed tools outside every workbench are not sent by default.",
        "bench.conflict": "Also in the global workbench, so it cannot be assigned here: {tools}",
        "global.title": "Global workbench",
        "global.desc": "These tools are always available and never change with the conversation. A tool cannot be both global and part of a workbench.",
        "unclassified.title": "Unclassified",
        "unclassified.count": "Installed but not in any workbench: {count}",
        "unclassified.empty": "Every installed tool is assigned.",
        "unclassified.toGlobal": "Put {name} into the global workbench",
        "unclassified.hint": "Not sent by default. Click a tool to move it into the global workbench, or tick it in a workbench above.",
        "tools.empty": "No tools available.",
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
  border:none;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-secondary,#8a8f98);
  font-size:13px;font-weight:500;line-height:20px;cursor:pointer;outline:none;}
.dswb-pill:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));}
.dswb-pill[disabled]{color:var(--dsw-alias-label-dimmed,#6b7078);cursor:default;}
.dswb-pill:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4c8dff));}
.dswb-pillLabel{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.dswb-chevron{flex:none;display:inline-flex;transition:transform .12s;}
.dswb-chevron[data-open="true"]{transform:rotate(180deg);}
.dswb-menu{position:absolute;z-index:40;bottom:calc(100% + 6px);left:0;min-width:220px;max-height:320px;overflow:auto;
  padding:6px;border-radius:10px;border:1px solid var(--dsw-alias-border-subtle,rgba(127,127,127,.25));
  background:var(--dsw-alias-bg-elevated,#fff);box-shadow:0 8px 28px rgba(0,0,0,.18);}
.dswb-menuItem{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;padding:7px 9px;
  border:none;border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary,inherit);font-size:13px;
  text-align:left;cursor:pointer;}
.dswb-menuItem:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));}
.dswb-menuItem[data-current="true"]{font-weight:600;}
.dswb-menuItem[disabled]{color:var(--dsw-alias-label-dimmed,#6b7078);cursor:default;}
.dswb-menuMeta{color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:12px;}
.dswb-tag{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border-radius:999px;
  background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.1));color:var(--dsw-alias-label-secondary,#8a8f98);
  font-size:12px;font-weight:500;white-space:nowrap;}
.dswb-tag[data-frozen="true"]{color:var(--dsw-alias-state-success,#3ba55d);}
.dswb-tagCount{opacity:.75;}
.dswb-page{display:flex;flex-direction:column;gap:20px;padding:4px 2px 24px;max-width:760px;color:var(--dsw-alias-label-primary,inherit);}
.dswb-title{font-size:15px;font-weight:600;margin:0;}
.dswb-desc{margin:0;color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:12.5px;line-height:1.55;}
.dswb-banner{padding:9px 12px;border-radius:8px;font-size:12.5px;line-height:1.5;
  background:var(--dsw-alias-state-warning-bg,rgba(232,163,61,.14));color:var(--dsw-alias-state-warning,#a9691a);}
.dswb-card{border:1px solid var(--dsw-alias-border-subtle,rgba(127,127,127,.22));border-radius:10px;padding:12px 14px;
  display:flex;flex-direction:column;gap:10px;}
.dswb-cardHead{display:flex;align-items:center;gap:8px;}
.dswb-input{flex:1;min-width:0;height:30px;padding:0 9px;font-size:13px;color:inherit;
  border:1px solid var(--dsw-alias-border-subtle,rgba(127,127,127,.3));border-radius:7px;background:transparent;outline:none;}
.dswb-input:focus{border-color:var(--dsw-alias-state-business-primary,#4c8dff);}
.dswb-btn{height:30px;padding:0 12px;font-size:12.5px;border-radius:7px;cursor:pointer;
  border:1px solid var(--dsw-alias-border-subtle,rgba(127,127,127,.3));background:transparent;color:inherit;}
.dswb-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));}
.dswb-btn[data-danger="true"]{color:var(--dsw-alias-state-error,#d64545);}
.dswb-btn[disabled]{opacity:.5;cursor:default;}
.dswb-tools{display:flex;flex-wrap:wrap;gap:6px 14px;}
.dswb-tool{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--dsw-alias-label-secondary,#8a8f98);
  cursor:pointer;}
.dswb-tool input{margin:0;accent-color:var(--dsw-alias-state-business-primary,#4c8dff);}
.dswb-chip{display:inline-flex;align-items:center;height:24px;padding:0 9px;border-radius:999px;font-size:12px;
  border:1px solid var(--dsw-alias-border-subtle,rgba(127,127,127,.3));background:transparent;
  color:var(--dsw-alias-label-secondary,#8a8f98);cursor:pointer;}
.dswb-chip:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary,inherit);}
.dswb-chip[disabled]{opacity:.5;cursor:default;}
.dswb-hint{font-size:12px;color:var(--dsw-alias-label-tertiary,#9aa0a8);}
.dswb-error{font-size:12.5px;color:var(--dsw-alias-state-error,#d64545);}
.dswb-empty{font-size:12.5px;color:var(--dsw-alias-label-tertiary,#9aa0a8);}
.dswb-sep{height:1px;background:var(--dsw-alias-border-subtle,rgba(127,127,127,.18));margin:2px 0;}
`;

    function ensureStyles() {
      if (typeof document === "undefined") return;
      if (document.querySelector(`style[data-plugin-css="${NS}"]`) !== null) return;
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
    /* small pieces                                                        */
    /* ------------------------------------------------------------------ */

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
            h("div", { className: "dswb-sep" }),
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
                    h("span", null, bench.name),
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
          frozen ? h(Lock) : null,
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
        frozen ? h(Lock) : null,
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

    function ToolChecklist({ tools, selected, disabled, onToggle }) {
      if (tools.length === 0) return h("div", { className: "dswb-empty" }, tr("tools.empty"));
      return h(
        "div",
        { className: "dswb-tools" },
        tools.map((tool) =>
          h(
            "label",
            { key: tool.name, className: "dswb-tool", title: tool.description || tool.name },
            h("input", {
              type: "checkbox",
              checked: selected.includes(tool.name),
              disabled,
              onChange: () => onToggle(tool.name),
            }),
            h("span", null, tool.name),
          ),
        ),
      );
    }

    function BenchCard({ bench, tools, config, disabled, onRename, onRemove, onTools }) {
      const [name, setName] = useState(bench.name);
      const [confirming, setConfirming] = useState(false);
      useEffect(() => setName(bench.name), [bench.name]);
      const conflicting = bench.tools.filter((name_) => config.global.includes(name_));
      const commitName = () => {
        const next = name.trim();
        if (next === "" || next === bench.name) {
          setName(bench.name);
          return;
        }
        onRename(bench.id, next);
      };
      return h(
        "div",
        { className: "dswb-card" },
        h(
          "div",
          { className: "dswb-cardHead" },
          h("input", {
            className: "dswb-input",
            value: name,
            disabled,
            "aria-label": tr("bench.name"),
            onChange: (event) => setName(event.target.value),
            onBlur: commitName,
            onKeyDown: (event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            },
          }),
          h(
            "button",
            {
              type: "button",
              className: "dswb-btn",
              "data-danger": confirming ? "true" : "false",
              disabled,
              onClick: () => {
                if (!confirming) {
                  setConfirming(true);
                  setTimeout(() => setConfirming(false), 4000);
                  return;
                }
                onRemove(bench.id);
              },
            },
            confirming ? tr("bench.confirmRemove") : tr("bench.remove"),
          ),
        ),
        h("div", { className: "dswb-hint" }, tr("bench.summary", { count: bench.tools.length })),
        h(ToolChecklist, {
          tools,
          selected: bench.tools,
          disabled,
          onToggle: (toolName) => {
            const next = bench.tools.includes(toolName)
              ? bench.tools.filter((item) => item !== toolName)
              : [...bench.tools, toolName];
            onTools(bench.id, next);
          },
        }),
        conflicting.length > 0
          ? h("div", { className: "dswb-error" }, tr("bench.conflict", { tools: conflicting.join(", ") }))
          : null,
      );
    }

    function SettingsPage() {
      const [config, setConfig] = useState(null);
      const [tools, setTools] = useState([]);
      const [error, setError] = useState(null);
      const [busy, setBusy] = useState(false);
      const [draft, setDraft] = useState("");

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

      if (config === null) {
        return h(
          "div",
          { className: "dswb-page" },
          error !== null
            ? h("div", { className: "dswb-error" }, error)
            : h("div", { className: "dswb-hint" }, tr("loading")),
        );
      }

      const disabled = busy || config.readOnly;
      const used = new Set(config.global);
      for (const bench of config.benches) for (const name of bench.tools) used.add(name);
      const unclassified = tools.map((tool) => tool.name).filter((name) => !used.has(name));
      const descriptionOf = new Map(tools.map((tool) => [tool.name, tool.description]));

      return h(
        "div",
        { className: "dswb-page" },
        h("h2", { className: "dswb-title" }, tr("title")),
        h("p", { className: "dswb-desc" }, tr("intro")),
        config.degraded
          ? h(
              "div",
              { className: "dswb-banner" },
              tr("degraded", { error: config.error ?? "unknown", file: config.file }),
            )
          : null,
        error !== null ? h("div", { className: "dswb-error" }, error) : null,
        h(
          "div",
          { className: "dswb-card" },
          h("div", { className: "dswb-cardHead" }, h("span", { className: "dswb-title" }, tr("create.title"))),
          h(
            "div",
            { className: "dswb-cardHead" },
            h("input", {
              className: "dswb-input",
              placeholder: tr("create.placeholder"),
              value: draft,
              disabled,
              onChange: (event) => setDraft(event.target.value),
              onKeyDown: (event) => {
                if (event.key !== "Enter") return;
                const name = draft.trim();
                if (name === "") return;
                setDraft("");
                mutate("/bench", { name });
              },
            }),
            h(
              "button",
              {
                type: "button",
                className: "dswb-btn",
                disabled: disabled || draft.trim() === "",
                onClick: () => {
                  const name = draft.trim();
                  setDraft("");
                  mutate("/bench", { name });
                },
              },
              tr("create.submit"),
            ),
          ),
        ),
        config.benches.length === 0
          ? h("div", { className: "dswb-empty" }, tr("empty"))
          : config.benches.map((bench) =>
              h(BenchCard, {
                key: bench.id,
                bench,
                tools,
                config,
                disabled,
                onRename: (id, name) => mutate("/bench/rename", { id, name }),
                onRemove: (id) => mutate("/bench/remove", { id }),
                onTools: (id, next) => mutate("/bench/tools", { id, tools: next }),
              }),
            ),
        h("div", { className: "dswb-sep" }),
        h(
          "div",
          { className: "dswb-card" },
          h("div", { className: "dswb-cardHead" }, h("span", { className: "dswb-title" }, tr("global.title"))),
          h("p", { className: "dswb-desc" }, tr("global.desc")),
          h(ToolChecklist, {
            tools,
            selected: config.global,
            disabled,
            onToggle: (name) => {
              const next = config.global.includes(name)
                ? config.global.filter((item) => item !== name)
                : [...config.global, name];
              mutate("/global", { tools: next });
            },
          }),
        ),
        h(
          "div",
          { className: "dswb-card" },
          h(
            "div",
            { className: "dswb-cardHead" },
            h("span", { className: "dswb-title" }, tr("unclassified.title")),
            h("span", { className: "dswb-hint" }, tr("unclassified.count", { count: unclassified.length })),
          ),
          unclassified.length === 0 ? null : h("p", { className: "dswb-desc" }, tr("unclassified.hint")),
          unclassified.length === 0
            ? h("div", { className: "dswb-empty" }, tr("unclassified.empty"))
            : h(
                "div",
                { className: "dswb-tools" },
                unclassified.map((name) =>
                  h(
                    "button",
                    {
                      key: name,
                      type: "button",
                      className: "dswb-chip",
                      disabled,
                      title: `${descriptionOf.get(name) ?? name}\n${tr("unclassified.toGlobal", { name })}`,
                      "aria-label": tr("unclassified.toGlobal", { name }),
                      onClick: () => mutate("/tools/move-to-global", { tools: [name] }),
                    },
                    name,
                  ),
                ),
              ),
        ),
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
