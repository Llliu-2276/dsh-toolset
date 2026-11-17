# DSH 桌面版客户端 UI 插件扩展机制调研（工作台下拉框 + 工作台管理页）

> 只读调研。所有结论来自 `app.asar` 解包后的可读 JS（带 JSDoc，非混淆）。
> **路径约定**：下文 `@deepseek-ai/xxx/lib/client.js:NNN` 均相对于
> `D:\PersonalFiles\PersonalProjects\dsh-toolset\tmp\src\dsh\node_modules\`。
> 解包工具：`tmp\extract.py`；未解包但被 `require()` 的运行时模块（`dsh-client-ui-slots`、
> `dsh-client-ui-primitives`、`dsh-client-store`）以 package 形式**不存在**于 asar，
> 它们由前端 boot bundle 作为模块表提供。

---

## 0. 结论先行

| 问题 | 结论 |
|---|---|
| 扩展点是否公开可用 | **YES（有条件）** —— 客户端 UI 的 slot 注册表 + `dsh.client` bundle 是公开机制，官方 skill 文档（随 app 分发）明确把它当作第三方扩展路径；但「工具白名单真正生效」必须在 host 侧，客户端插件做不到 |
| 工作台下拉框放哪 | `conversation.input.right`（`kind: list`、`scope: session`），**当前没有任何内置包占用**，渲染位置正好在 `.standardControls` 内、模型座左侧 = 「模型下拉框旁边」 |
| 要不要改布局包 | **不用**。`dsh-client-ui-conversation` 已经声明并渲染了这个 list slot；只需新增一个 client 包 |
| 设置页怎么加 | 注册 `name: "settings.section"`（`kind: list`, `scope: root`），`order` 排在 15（内置插件）与 20（Agent 预设）之间 |
| 下拉框如何知道当前工作台 | 会话作用域 slot 的 `inject(sessionId)` 直接给会话 id；当前值走**会话投影面**（`session.projections.faceOf(...)`）或 `ctx.remote.$on(...)` 事件 |
| 会话切换感知 | 不需要专门事件：slot 作用域跟随会话重建；另外可用 `ctx.sessions.list`（snapshot store）与 `ctx.on("connection/reset")` |
| 最小改动面 | 新增 1 个 bundle（host `index.js` + `client.js` + `cordis.patch.yml` + `package.json`），0 行改动到现有发布包 |

---

## 1. 模型下拉框到底由谁渲染：组件、父容器、周边控件

### 1.1 归属

| 项 | 值 |
|---|---|
| 包 | `@deepseek-ai/dsh-client-ui-model-selection` |
| 组件 | `ModelSelect`（`@deepseek-ai/dsh-client-ui-model-selection/lib/client.js:1160`） |
| 注册的 slot | `conversation.input.model`（同文件 `:2061-2086`） |
| slot 声明方 | `@deepseek-ai/dsh-client-ui-conversation/lib/client.js:22958-23001`（`registerComposerBar()`，slot 名 `conversation.composer.bar`） |
| slot 种类 | `kind: "single"`, `scope: "session"` —— 独占，第三方**不能**再往里塞第二个控件 |

```js
// @deepseek-ai/dsh-client-ui-model-selection/lib/client.js:2061-2086
ctx.inject(["slots", "modelDirectories"], (scope) => {
  scope.slots.inject("conversation.input.model", () => scope.slots.register({
    name: "conversation.input.model",
    locale: NS,
    children: { "conversation.input.model.label": { kind: "single", scope: "session", inline: true } },
    inject: (sessionId) => {
      const directory = models.directoryFor(sessionId);
      const available = sessions.subagentAddress(sessionId) === void 0;
      return {
        available,
        directory: directory.store,
        load: () => { /* ... */ },
        resolveText: (text) => ctx.locale.resolveText(text),
        select: (selection) => available ? directory.select(selection) : Promise.resolve(void 0),
      };
    }
  }, ModelSelect));
});
```

组件的 props 形状（同文件 `:1160`）：

```js
function ModelSelect({ locked, available, directory, load, select, resolveText, t, renderSlot })
```

- 状态：`useSyncExternalStore(directory.subscribe, directory.getSnapshot)`
- 触发器（`:1487-1519`）：`<button className={trigger} aria-haspopup="menu" aria-expanded title disabled={locked}>`
  内含 `IconDataOutlineRegular`（16px）+ `span.triggerLabel` + 可选 `span.triggerEffort` + 箭头；
  进行中显示 `StateDot state="ongoing"`。
- 菜单定位（`:1175-1184`）：`useAnchoredPosition({ open, anchorRef, panelRef, side: "top", align: "end", gap: 8, margin: 12, layoutKey: pane })`
  —— **向上弹**，右对齐。
- 二级菜单：根层 Model / Effort 两行，进入 provider 分组列表 / effort 列表；模型数 > 4 时出现模糊搜索。
- 选择失败若 `error.code === "session/writer-held"`，toast 走 `t("error.sessionInUse")`。
- 附带一个 `/model` 命令装饰（`:2029-2059`）：`command.register({ name:"model", ui:{ kind:"popupSelect", searchMode:"fuzzy-label", options, onSelect } })`。

**触发器尺寸（决定「旁边能不能再塞一个」）** —— `@deepseek-ai/dsh-client-ui-model-selection/lib/client.js:1063`（CSS 常量）：

```css
._9r0rkG_trigger{border-radius:var(--dsw-radius-sm);min-width:0;max-width:360px;height:28px;
  color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;outline:none;
  align-items:center;gap:4px;padding:0 4px 0 8px;font-size:13px;font-weight:400;line-height:20px;display:flex}
```

即：**28px 高、13px 字号、无底色、文字 `--dsw-alias-label-secondary`、圆角 `--dsw-radius-sm`**。
（`hover` 时 `background: var(--dsw-alias-interactive-bg-hover)`；disabled 用 `--dsw-alias-label-dimmed`。）
新控件照这个规格写，视觉上才「像同一个东西」。

### 1.2 「输入框下方那一行」的结构

`@deepseek-ai/dsh-client-ui-conversation/lib/client.js:22068-22120`（`InputBar` 渲染，组件签名 `:21757`）：

```
div.InputBar.root            （.GRgSLq_root；hero 变体加 .GRgSLq_hero）
├─ div.notice?               （提示条）
└─ div.card[data-composer-card]                    （.GRgSLq_card）
   ├─ div.overlayAnchor[data-composer-overlay] → conversation.input.overlay   (list, session)
   ├─ div.accessory                                                            （附件区）
   ├─ conversation.input.attachments                                          (single, session-maybe)
   ├─ DraftEditor                                                             （正文 textarea）
   └─ div.row                                                   ← 22068  .GRgSLq_row
      ├─ div.tools                                              ← 22070  .GRgSLq_tools（activity 激活时 hidden）
      │  ├─ Tooltip > button.add  "+"   （IconPlusOutlineMedium size 14）
      │  ├─ input[type=file][hidden]
      │  ├─ div.modes → conversation.input.permission (single) + conversation.input.plan (single)   ← 22100
      │  └─ conversation.input.left                            ← 22102  (list, session) ［当前无占用］
      └─ div.trailing                                           ←        .GRgSLq_trailing
         ├─ div.standardControls                                ← 22108  .GRgSLq_standardControls
         │  ├─ conversation.input.right                        ← 22110  (list, session) ［空］
         │  └─ conversation.input.model                         ← 22110  (single, session)「DeepSeek-V4.1-Flash 神眯 ⌄」
         ├─ conversation.input.activity                         ← 22114  (single, session)
         └─ button.stop.primary / button.send.primary           （停止 / 发送 ↑）
```

对应 JSX（`@deepseek-ai/dsh-client-ui-conversation/lib/client.js:22108-22114`）：

```js
className: InputBar_module_css_default.standardControls,
children: [
  input === void 0 || sessionId === void 0 ? null : renderSlot("conversation.input.right", {}),
  sessionId === void 0 ? null : renderSlot("conversation.input.model", { locked: modelSeatLocked })
]
```

**关键**：`conversation.input.right` 是一个**已声明、已渲染、且当前为空**的 `list` slot，
位置就是「模型座左边」。全仓库 grep（所有已解出的 client 包）：

| slot | 谁注册 | 种类 |
|---|---|---|
| `conversation.input.model` | model-selection | single |
| `conversation.input.permission` | permission-presets（「⚙ 工作区内修改」） | single |
| `conversation.input.overlay` | input-trigger、commands | list |
| `conversation.input.dock` | goal、conversation（队列/待办） | list |
| `conversation.composer.dock` | chat | list |
| `conversation.input.left` / `.right` | **无人** | list |
| `conversation.hero.options` | **无人** | list |

### 1.3 新会话（hero）视图的那一行是另一套

`@deepseek-ai/dsh-client-ui-conversation/lib/client.js:20522-20555`：

```js
const heroWorkspaceRow = jsxs("div", { className: ConversationRoot_module_css_default.heroWorkspaceRow, children: [
  jsx(WorkspaceChip, { buttonRef: pickerAnchor, label: chipTitle, menuOpen: pickerOpen, onClick: ... }),
  renderSlot("conversation.hero.workspace", { open, anchorRef, selectedId, onPick, onClose }),
  renderSlot("conversation.hero.agentPreset", {}),
  sessionId === void 0 ? null : jsx("div", { className: ConversationRoot_module_css_default.heroOptions,
                                            children: renderSlot("conversation.hero.options", {}) })
]});
```

即截图 1 的 `📁 dsh-toolset ⌄  ⚙ 标准模式 ⌄`：工作区胶囊 + `conversation.hero.workspace`（single, root）+ `conversation.hero.agentPreset`（single, session-maybe）+ `heroOptions` 容器内的 `conversation.hero.options`（list）。
→ **hero 行里加第二个下拉只能在 `conversation.hero.options`（list）里加**；两个 single 位置都已被占。

---

## 2. 客户端插件的 UI 扩展机制

### 2.1 机制总览

一个「bundle」= 一个 package，具备三件套：

1. `package.json` 里 `dsh.bundle.patch`（host 侧插入表）+ `dsh.client`（浏览器侧声明）+ `exports["./client"]`；
2. `cordis.patch.yml`：往配置树里 `insert` 一行插件；
3. `index.js`（host，可空）+ `client.js`（浏览器，`window.__ModuleLoader__.load`）。

`dsh.client` 的字段（模板原文）：`platform`（`"web"`）、`immediately`、`inject`（依赖的其它 client 包）、`external`（非基线运行时 import）。

### 2.2 最小可运行写法（官方模板，逐字）

`@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/templates/decoration/package.json`：

```json
{
  "name": "@local/my-decoration",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./index.js",
    "./client": "./client.js",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg"
  },
  "files": ["index.js", "client.js", "cordis.patch.yml", "locale/*.json", "icon.svg"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "immediately": true, "inject": ["@deepseek-ai/dsh-client-ui-conversation"] }
  }
}
```

`templates/decoration/cordis.patch.yml`：

```yaml
- insert:
    - id: my-decoration
      name: '@local/my-decoration'
```

`templates/decoration/index.js`：

```js
export function apply() {}
```

`templates/decoration/client.js`（22 行，完整）：

```js
window.__ModuleLoader__.load({
  id: '@local/my-decoration',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    function Decoration() {
      return h('svg', { viewBox: '0 0 64 64', width: 48, height: 48, 'aria-hidden': true,
                        style: { display: 'block', pointerEvents: 'none' } },
               h('circle', { cx: 32, cy: 32, r: 24, fill: '#247bbf' }));
    }
    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock', id: 'my-decoration', order: 5,
        }, Decoration));
      },
    };
  },
});
```

**装到哪**：`conversation.composer.dock` 是输入框卡片下方的 dock 行（居中对齐，`min-height: 22px`），
在截图里就是输入框正下方那条窄带。

### 2.3 slot 注册表 API（从真实调用点反推）

```js
// 注册（带归属声明：owner slot 不存在时不执行；owner 消失时自动 dispose）
ctx.slots.inject("<ownerSlotName>", () => ctx.slots.register({
  name: "<targetSlotName>",     // 必须等于 owner
  id?: string,                  // list/keyed slot 内的唯一 id
  order?: number,               // list 内排序（小的在前）
  locale?: string,              // 组件拿到的 t 绑定到该命名空间
  label?: () => string,         // 供宿主渲染导航/标题（settings.section 用）
  children?: { "<childSlot>": { kind, scope, inline? } },   // 声明自己区域内的子 slot
  inject?: (sessionId?) => ({ hooks?: {...}, ...props }),   // 座席注入
  store?: any,                  // root 作用域可共享的 store
}, Component));
```

- `inject` 返回对象里的 `hooks: { foo }` 会被转成组件 prop **`useFoo(selector?)`**（见 §3.1 的 `usePermissionCatalog`、§3.3 的 `useGoalActivation`）。
- `scope: "session"` 的 slot，`inject(sessionId)` 的 `sessionId` 一定有值；`"session-maybe"` 可能 `undefined`（hero 新会话）。
- 会话作用域组件还会额外拿到框架 props：`sessionId`、`useSession`、`useSessions`、`useProjection`、`renderSlot`、`renderFactorySlot`、`t`（见 `ChatView` @ `dsh-client-ui-chat/lib/client.js:3451`、`InputBar` @ `:21757`）。

### 2.4 「追加一个控件」还是「整块替换」？

由宿主声明 slot 时定的 `kind` 决定，第三方**无法改变**：

| kind | 语义 | 能否追加 |
|---|---|---|
| `list` | 多条目，按 `order` 排 | **能追加**（`conversation.input.right`、`.left`、`hero.options`、`input.dock`、`composer.dock`、`settings.section`、`settings.action`、`shell.overlay`） |
| `single` | 独占一个 | 只能占位/替换；已占用时冲突 |
| `chain` | 链式包裹，可装饰 | 能「包一层」 |
| `keyed` | 按 key 一条 | 能按 key 追加（如 `settings.models.provider-card`） |

**结论**：机制既支持「往已有区域追加控件」（找 list slot），也支持「新增整块区域」（自己 `register` 一个带 `children` 的 slot，再往里填）。但**不能**把控件塞进别人占用的 single 位，也**不能**在别人的区域里新建 slot。

### 2.5 硬约束（`references/practices.md` / `ui-plugin.md`）

- **不要** `require('@deepseek-ai/dsh-client-ui-primitives')`；自己写控件并对齐宿主样式；
- 样式只用 `--dsw-alias-*`（及 `--dsw-specific-*`）token；
- 不要替换 app root、不要往 `document.body` 追加第二个应用、不要读别的插件的 DOM/样式；
- 工厂函数保持无副作用；样式/定时器/监听器都在 `apply` 里用 `ctx.effect` / `ctx.on` 注册并返回清理函数；
- 文案走 Client locale（`ctx.locale.register(ns, dicts)` + slot 的 `locale`）；
- 「优先选已经分配好空间的 slot，例如 `conversation.composer.dock`」。

---

## 3. 现成范本

### 3.1 `permission-presets` 的权限档下拉（与本需求最接近）

`@deepseek-ai/dsh-client-ui-permission-presets/lib/client.js`

```js
// :926-940 依赖
const inject = ["commandUi","connection","sessions","slots","locale","remote",
                "remote.permissionPresets","remote.settings","configForms","settingsSchema"];

// :942-944 当前值 = 会话投影面
function selectionOf(session) { return session?.projections.faceOf("permissions").getSnapshot(); }

// :982-990 写入 = 在该会话上执行斜杠命令
const sessionFor = (session) => sessions.binding(session.sessionId)?.session;
const submit = async (sessionId, preset) => {
  const live = sessions.binding(sessionId)?.session;
  if (live === void 0) throw new Error("this session is not materialized yet");
  const result = await live.command(`/permission ${preset}`);
  if (!result.ok) throw new Error(`permission switch failed: ${result.error.code}: ${result.error.message}`);
  if (!result.value.matched) throw new Error("the host offers no /permission command");
  return true;
};

// :1026-1033 座席注册（single slot，只能占位）
ctx.slots.inject("conversation.input.permission", () => ctx.slots.register({
  name: "conversation.input.permission",
  locale: PERMISSION_ACCESS_NS,
  inject: (sessionId) => ({
    hooks: { permissionCatalog: catalog.store },
    select: (preset) => submit(sessionId, preset)
  })
}, PermissionSelect));

// :519-521 组件：hooks 变 hook，当前值走 useProjection
function PermissionSelect({ locked, select, usePermissionCatalog, useProjection, t }) {
  const selection = useProjection("permissions");
  const catalog = usePermissionCatalog((state) => state.value);
  // ...
}
// :537 能力缺失时整体不渲染
if (selection === void 0 || catalog === null) return null;
```

读取目录（进程级 catalog）走 typert：

```js
// :120
const operation = this.ctx.remote.permissionPresets.catalog().then((result) => { /* ... */ });
// :42 变更通知
this.stopCatalog = ctx.remote.$on("permission-presets/catalog-changed", () => { /* invalidate */ });
```

同一个 catalog 还顺手装饰了 `/permission` 命令（`:1034-1046`），并在「通用设置」里加了一行：

```js
// :1019-1025
ctx.slots.inject("settings.general.item", () => ctx.slots.register({
  name: "settings.general.item", id: "permission", order: -20,
  locale: "settings.permission", inject: injected
}, PermissionRow));
```

**这就是工作台下拉框的完整模板**：`inject(sessionId)` → `select` 回调 → `sessions.binding(id).session.command(...)`；当前值 → `useProjection(...)`。

### 3.2 `agent-preset` 的胶囊 + 会话标签 + 设置页（三处注册）

```js
// @deepseek-ai/dsh-client-ui-agent-preset/lib/client.js:3025-3044
const chip = scope.slots.register({
  name: "conversation.hero.agentPreset",       // single, session-maybe（hero 行「⚙ 标准模式 ⌄」）
  locale: "settings.agentPreset", inject: seatInjected
}, AgentPresetSeat);
const label = scope.slots.register({
  name: "conversation.session.header.actions", id: "agent-preset", order: -10,   // list，会话头
  locale: "settings.agentPreset", inject: labelInjected
}, AgentPresetLabel);

// :3080-3087 设置页分区
ctx.slots.inject("settings.section", () => ctx.slots.register({
  name: "settings.section", id: "agent-presets", order: 20,
  label: () => ctx.locale.bind("settings.agentPreset")("nav"),
  locale: "settings.agentPreset", inject: sectionInjected
}, AgentPresetSection));
```

RPC 调用（同一文件）：

| 行 | 调用 |
|---|---|
| 1696 | `await ctx.remote.agentPresets.list()` |
| 2668 | `await this.ctx.remote.agentPresets.select(session.id, staged)` |
| 2750 | `ctx.remote.agentPresets.read(id)` |
| 1679 | `await ctx.remote.settings.update(AGENT_PRESET_SETTINGS_NS, { selectedDefault: id }, expectedRevision)` |
| 2964 | `ctx.remote.$on("settings/document-updated", (ns) => {...})` |
| 2968 | `ctx.on("connection/reset", refresh)` |
| 2887-2908 | 每个会话一个 `AgentPresetSeatController`，在 `ctx.sessions.list.subscribe` 时按绑定重建 |

### 3.3 `goal` 的输入框 dock（最小的「会话级读 + 写」闭环，757 行）

```js
// @deepseek-ai/dsh-client-ui-goal/lib/client.js:648-652
const inject = ["slots","sessions","remote","remote.goals","locale","uiConversation"];   // :648-655

// :685-692 读当前值：会话投影面
const refOf = (sessionId) => {
  const projection = (sessions.binding(sessionId)?.session.projections.faceOf("goal"))?.getSnapshot();
  if (projection == null) return void 0;
  return { id: projection.goal.id, revision: projection.goal.revision };
};

// :700-747 注册到 list slot，注入里直接用 sessionId
ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
  name: "conversation.input.dock", id: "goal", order: 10, locale: NS,
  inject: (sessionId) => {
    const binding = sessions.binding(sessionId);
    if (binding === void 0) throw new Error(`ui-goal: session "${sessionId}" is unavailable`);
    return {
      hooks: { goalActivation: createGoalActivationSource({ projection: binding.session.projections.faceOf("goal"), ... }) },
      onEdit: async (objective) => {
        const ref = refOf(sessionId);
        if (ref === void 0) return noCurrentGoal;
        return await ctx.remote.goals.edit(sessionId, ref, { objective });   // 带 CAS ref
      },
      onPause: async () => await ctx.remote.goals.pause(sessionId, refOf(sessionId)),
      onResume: async () => await ctx.remote.goals.resume(sessionId, refOf(sessionId)),
      onClear: async () => await ctx.remote.goals.clear(sessionId, refOf(sessionId)),
    };
  }
}, GoalDock));
```

事件（`:720-723`）：`ctx.remote.$on("goal/activation-changed", (event) => { if (event.sessionId === sessionId) listener(event.goal); })`，
重连：`ctx.on("connection/reset", listener)`。

---

## 4. 设置页：注册新分区 / 页面

### 4.1 宿主怎么消费 `settings.section`

`@deepseek-ai/dsh-client-ui-settings-general/lib/client.js`（整个设置弹窗的声明方）：

```js
// :1522-1562
ctx.slots.register({
  name: "sidebar.settings", locale: NS, store: shellStore,
  children: {
    "settings.launcher":        { kind: "single", scope: "root" },
    "settings.trigger":         { kind: "single", scope: "root" },
    "settings.header":          { kind: "single", scope: "root" },
    "settings.action":          { kind: "list",   scope: "root" },   // 右上角按钮区
    "settings.close":           { kind: "single", scope: "root" },
    "settings.section":         { kind: "list",   scope: "root" },   // 左侧导航 + 右侧页面
    "settings.section.icon":    { kind: "list",   scope: "root", inline: true },
    "settings.onboarding":      { kind: "list",   scope: "root" }
  },
  inject: shellInjected
}, SettingsRoot);

// :1434-1439 导航 = entries + order 排序
ctx.slots.entries("settings.section").map((e) => ({
  id: e.options.id ?? "", order: e.options.order ?? 0,
  label: resolveSlotLabel(e.options.label) ?? ""
})).sort((a, b) => a.order - b.order)

// :341 右侧正文只渲染当前分区
children: active !== void 0 && renderSlot("settings.section", { close: onClose }, { only: active })
```

现有分区的 `order`（决定「工作台」插在哪）：

| order | id | 包 | 文件:行 |
|---|---|---|---|
| 0 | `general`（通用设置） | settings-general | `:1587` |
| 10 | `models`（模型） | settings-models | `:5465` |
| 15 | `plugins`（内置插件） | settings-plugins | `:255` |
| 20 | `agent-presets`（Agent 预设） | agent-preset | `:3080` |
| — | `account`（账号与余额） | settings-account | `:5420`，包在 `ctx.remoteAccess.whenAccess("account/watch", ...)` 里 |

→ 工作台管理页取 `order: 16`~`19`（内置插件之后、Agent 预设之前），或 `21`（Agent 预设之后）。

### 4.2 最小骨架

```js
ctx.slots.inject("settings.section", () => ctx.slots.register({
  name: "settings.section",
  id: "workspaces",
  order: 18,
  label: () => t("nav"),            // 左侧导航文字
  locale: "settings.workspace",     // 组件里的 t 绑定该命名空间
  inject: (() => {
    const store = createWorkspaceStore(ctx);       // 自建 store，见 §5
    return () => ({ hooks: { workspaces: store }, reload: () => store.load() });
  })(),
}, WorkspaceSection));

function WorkspaceSection({ useWorkspaces, reload, t }) {
  const state = useWorkspaces((s) => s);
  React.useEffect(() => { reload(); }, [reload]);
  return (
    <section>
      <h2>{t("nav")}</h2>
      <p>{t("intro")}</p>
      <ul>{state.rows.map((row) => <li key={row.id}>{/* 卡片：名字 / 工具数 / 删除 / 设为默认 */}</li>)}</ul>
      {/* 第三方插件不要 require primitives：图标自带 SVG，样式用 --dsw-alias-* token */}
      <button type="button" onClick={() => store.create()}>{t("create")}</button>
    </section>
  );
}
```

### 4.3 现成的「条目列表 + 增删」范式（可直接抄）

`AgentPresetSection`（`@deepseek-ai/dsh-client-ui-agent-preset/lib/client.js:2273-2400`）就是截图 2 那张网格：
`<section>` → `<h2>{t("nav")}</h2>` → `<p class=intro>` → 错误 `<p role="alert">` →
两组 `<section class=group><h3 class=groupHead>` → `<ul class=cards>` → 每张卡 `<li class=card data-agent-preset-id=...>`
内含「主按钮（点击 = 设为默认，`aria-pressed` / `disabled`）+ `Tag`（在用/内置/自定义）+ `<code class=cardId>` + 描述」+ 失败徽标；
自定义组末尾挂「+ 让 Agent 帮我创建」按钮：

```js
// :2296-2305
const creatorButton = jsxs("button", {
  type: "button", className: AgentPresetSection_module_css_default.creatorButton,
  disabled: state.saving,
  onClick: () => { creator(); closeSettings(); },
  children: [jsx(IconPlusOutlineRegular, { size: 14 }), t("creatorDraft")]
});
```

其它可参考的列表范式：

- **keyed 列表 + 页脚**：`settings.models.provider-card`（`{kind:"keyed", scope:"root"}`）+ `settings.models.footer`（`{kind:"list", scope:"root"}`），`@deepseek-ai/dsh-client-ui-settings-models/lib/client.js:5465`；
- **页内 tab 列表**：`settings.plugins.tab`（`{kind:"list", scope:"root"}`），`@deepseek-ai/dsh-client-ui-settings-plugins/lib/client.js:255`；
- **把详情页塞进「内置插件」列表**：`plugins.item`（`{id:"shell", order:40, label:()=>t("title")}`），`@deepseek-ai/dsh-client-ui-settings-shell/lib/client.js:290-297`。

### 4.4 设置数据存哪（插件自己的配置）

官方做法（`references/host-plugin.md:66-77`）：插件不碰用户的 `cordis.patch.yml`，而是用 config editor：

```js
const entry = ctx.fiber.entry
const editor = ctx.get('configEditor')
if (entry === undefined || editor === undefined) throw new Error('Configuration cannot be saved in this profile')
await editor.edit(entry, current => ({ ...current, workspaces: nextList }))
```

配 `export const Config`（schemastery）后，设置页的表单框架（`configForms`）能自动渲染；插件行还会自动出现在「内置插件」页里（`settings-plugin-inventory`）。

---

## 5. 客户端 ↔ host 通信：三条路 + 具体调用

### 5.1 路 A：settings（无需自定义 RPC，最省事）

`@deepseek-ai/dsh-api-settings-controller/lib/typert.remote-client.js` 提供的方法名：

```
'settings/describe'  'settings/mutate'  'settings/openSettingsDocument'  'settings/replace'  'settings/update'
```

客户端用法（真实调用点）：`ctx.remote.settings.update(ns, patch, expectedRevision)`（agent-preset `:1679`）、
`ctx.remote.settings.mutate(ns, ops)`（permission-presets `:862`）、`ctx.remote.$on("settings/document-updated", ns => ...)`。
「打开配置文件」按钮对应的就是 `openSettingsDocument`。

→ **读工作台列表**：`ctx.remote.settings.describe()` 后取自己的工作台命名空间；或直接读插件自身 config（§4.4）。

### 5.2 路 B：会话命令（写「当前会话的选择」最短路径，已被 permission 验证）

```js
const live = sessions.binding(sessionId)?.session;
const result = await live.command(`/workspace ${workspaceId}`);
// result: { ok: true, value: { matched: true, ... } } | { ok:false, error:{code,message} }
```

host 侧注册一个会话命令即可（`/permission` 就是这么来的）。优点：不需要 typert codegen，不需要新 RPC 面；
缺点：命令是「动作」，读当前值仍要靠投影面或事件。

### 5.3 路 C：typert RPC（类型化服务，适合「读列表」）

链路：

1. 包内 `lib/typert.host.js` 导出 manifest（`{ package, face:"host", schemas, model, invocations }`）；
2. `package.json` 的 `exports` 加 `"./typert": { "default": "./lib/typert.host.js" }`；
3. 运行时 `@deepseek-ai/dsh-typert-loader` 扫描每个挂载包的 exports，校验形状后 `ctx.typert.register(manifest)`：

```js
// @deepseek-ai/dsh-typert-loader/lib/index.js:39
const TYPERT_HOST_EXPORT = "./typert";
// :79-84 校验
if (manifest.package !== pkgName) throw new Error(`typert-loader: ${pkgName} TYPERT manifest names package ...`);
if (manifest.face !== "host") throw new Error(`typert-loader: ${pkgName} exports "./typert" but TYPERT.face is not "host"`);
// :323
registered.set(entryName, ctx.typert.register(manifest));
```

4. 客户端面：`lib/typert.remote-client.js` + `exports["./remote"]`，导出的 `TYPERT_REMOTE` 由 remote 桥挂到 `ctx.remote.<service>.<method>`。

manifest 形状（`@deepseek-ai/dsh-agent-preset-registry/lib/typert.host.js:38+`，由 `dsh-typert-generator` 生成）：

```js
createTypertRemoteInfo({
  package: "@deepseek-ai/dsh-agent-preset-registry",
  methods: {
    "agentPresets/list":   { service:"agentPresets", implementation:"remoteExportList",
                             invocation:{ kind:"direct" }, parameters: [],
                             result: { mode:"strict", typeSymbol, create: zSchema, jsonSchema } },
    "agentPresets/select": { invocation:{ kind:"direct" },
                             scope: { context:"agent", wire:"agentId" },
                             parameters: [ { name:"agent", wire:"agentId", source:"lookup", lookup:"agent" },
                                           { name:"agentPreset", source:"json" } ] }
  }
}, z)
```

→ 若要做「工作台列表」服务，就是 `workspaces/list`（无参数）与 `workspaces/select`（参数 `sessionId`）。
**注意**：`dsh-typert-generator` 不在 app.asar 里（只有 `-protocol` / `-registry` / `-loader`），
所以「手写 manifest 能否被接受」未经实测，见 §8。

### 5.4 事件（host → client 推送）

`@deepseek-ai/dsh-api-remotes/lib/index.js:152-155`：

```js
const inject = ["typertGateway"];
ctx.effect(() => ctx.typertGateway.registerRemoteEvents(remoteEventSource(ctx), { home: homedir() }), ...);
```

即 `ctx.remote.$on("<event>", handler)` 是**转发的 Cordis 事件流**，host 侧 `ctx.emit("<event>", payload)` 即可。
范例：`ctx.remote.$on("goal/activation-changed", e => ...)`、`ctx.remote.$on("permission-presets/catalog-changed", ...)`。

### 5.5 把这个下拉框需要的东西对上号

| 需求 | 走哪条路 | 具体写法 |
|---|---|---|
| 读工作台列表 | A（settings）或 C（RPC） | `ctx.remote.settings.describe()` / `ctx.remote.workspaces.list()` |
| 写当前会话选择 | B（命令）或 C（RPC） | `sessions.binding(id).session.command("/workspace " + id)` / `ctx.remote.workspaces.select(sessionId, id)` |
| 显示当前值 | 投影面 | `useProjection("workspace")`（需 host 侧加投影面）或 `sessions.binding(id)?.session.projections.faceOf("...")` |
| 列表变更后刷新下拉 | 事件 | `ctx.remote.$on("workspace/changed", refresh)` |
| 真正限制工具 | **host 侧** | `ctx.tools.restrict({ allow: [...] })`，见 §5.6 |

### 5.6 工具白名单的实际执行点（这是「工作台」的硬约束）

`@deepseek-ai/dsh-tools/lib/index.js:446-467`：

```js
/**
 * Restrict global tools for the calling agent scope. Empty filters, unknown
 * names, scope-local names, and reserved transport names fail. Restrictions
 * intersect; scoped registrations remain visible.
 * @param filter - global-tool mask: `allow` (keep only) and/or `deny` (remove).
 * @returns the exact disposer that lifts this restriction.
 */
restrict(filter) {
  const scope = scopeOf(this.ctx);
  if (scope === void 0) throw new Error("tools.restrict() requires a scoped context (agent.ctx): a context-global restriction would mask every agent — deny the tool for the intended agent instead");
  // ...
  const unknown = [...allow ?? [], ...deny ?? []].filter((name) => !known.has(name));
  if (unknown.length > 0) throw new Error(`tools.restrict() names unknown global tool${...}`);
  return this.layers.effect(this.ctx, (layer) => layer.restrictions.append(compiled), { label: "tools.restrict()" });
}
```

要点：

- 只能**按 agent 作用域**限制（`agent.ctx`），全局限制会报错 —— 所以「工作台」必须是**每个 Agent 生效**的东西；
- `allow` 名称必须是「可限制的全局工具名」（`this.view(scope).restrictableNames`），`run_code` 保留名不能列；
- 多个限制取交集；
- 这与 **Agent 预设**（`标准模式/创造模式`）本质是同一层机制 —— 预设就是「工具组合 + 提示词」。

→ 产品含义：「工作台 = 工具白名单分组」在实现上要么复用 agent preset（每个工作台生成一个预设/组合），
要么在 host 侧按会话选择注入 `ctx.tools.restrict()`。客户端只负责选择 UI。

---

## 6. 三张截图的结论（布局 + 交互影响）

### 6.1 图 1（新会话 / hero，`Snipaste_2026-11-15_19-06-22.png`）

- 输入框卡片上方一行：`📁 dsh-toolset ⌄`（工作区胶囊）→ `⚙ 标准模式 ⌄`（agent 预设座席，正展开：标准模式 / 创造模式 / P0 Probe2）。
- 卡片内部底行：左 `+`、`⚙ 工作区内`；右 `DeepSeek-V4.1-Flash 神眯 ⌄` + 圆形 ↑。
- 与代码对应：hero 行的两个 single 位已被工作区 + 预设占用；模型座位在卡片内 `.standardControls`。

### 6.2 图 2（设置页，`Snipaste_2026-11-15_19-06-54.png`）

- 左侧 10 个分区（账号与余额 / 通用设置 / 模型 / 内置插件 / Agent 预设 / IM 机器人 / 技能 / 插件市场 / bili 设置 / 侧边卡片），与 §4.1 的 `order` 升序一致。
- 右侧是 `Agent 预设` 页：说明文字 + 「内置」两列卡片 + 「自定义」两列卡片 + 「+ 让 Agent 帮我创建」+ 右上「打开配置文件」。
- 卡片形态：标题 + 徽标（新任务默认 / 内置 / 自定义）+ `code` 形式的 id + 描述 + 底部链接（模式说明 / 如何使用）；失败卡片标红 `加载失败` 并附错误文本。
- → **工作台管理页照抄这个形态**即可（卡片网格 + 新建卡片 + 打开配置文件）。

### 6.3 图 3（会话态，`Snipaste_2026-11-15_19-07-49.png`）

- 顶栏：会话标题 + 预设名「P0 Probe2」+ tab（对话/上下文/…）。
- 输入框底行与图 1 同构；下方多一条统计行（`312 tok/s` / `缓存命中 0%` / `2%`），那是 `conversation.composer.dock` 之类的 dock 区。

### 6.4 加一个「工作台」胶囊要动什么

**不需要改布局包。** 依据（`@deepseek-ai/dsh-client-ui-conversation/lib/client.js:21701` 的 CSS 常量）：

```css
.GRgSLq_row{flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;
  min-width:0;padding:2px 8px 6px;display:flex;container-type:inline-size}
.GRgSLq_tools,.GRgSLq_modes,.GRgSLq_trailing{align-items:center;min-width:0;display:flex}
.GRgSLq_tools,.GRgSLq_modes{gap:12px}
.GRgSLq_trailing{flex:none;gap:12px;margin-left:auto}
.GRgSLq_standardControls{align-items:center;gap:12px;min-width:0;display:flex}
@container (width<=560px){.GRgSLq_tools,.GRgSLq_modes,.GRgSLq_trailing{gap:8px}}
[data-model-compact]{--dsh-composer-model-text-display:none;--dsh-composer-model-icon-display:block}
```

- 底行是 `flex-wrap: wrap` 且 `container-type: inline-size`（容器查询），右簇 `.trailing{flex:none; margin-left:auto}`；
- 加一个 ~90–140px 的胶囊：在 ≥560px 的卡片宽度下只是把 `.trailing` 变宽（`.standardControls` 的 `gap:12px` 自动留间距），**不会挤压输入区**——输入区（`DraftEditor`）在上一行，不与之共享宽度；
- <560px（容器查询断点）时 gap 自动收到 8px；再窄就会整簇换行到第二行（因为 `flex:none` 不允许收缩）；
- 若要更省空间：复用 `[data-model-compact]` 的思路 —— 窄容器下只显示图标 + 隐藏文字（`--dsh-composer-model-text-display:none`）。给自己加一个 `data-workspace-compact` 或 `--dsh-*` 变量即可，仍不需要改宿主。

**要动的包**：只新增一个 client 包（+ 可选 host 包）。`dsh-client-ui-conversation`、`dsh-client-ui-model-selection`、`dsh-client-ui-settings-general` **都不用改**。

**位置选择**：

| 位置 | slot | 形态 | 评价 |
|---|---|---|---|
| 模型下拉左边（同簇） | `conversation.input.right`（list, session） | 与模型同款 28px 胶囊 | **推荐**，正是产品要的「模型下拉框旁边」 |
| 输入框左下（+ 号后、权限档旁） | `conversation.input.left`（list, session） | 同款胶囊 | 备选，靠近「⚙ 工作区内」 |
| hero 行（新会话） | `conversation.hero.options`（list, session） | 需自己写胶囊（无默认样式） | 若要新会话也能选，必须加这里 |

---

## 7. 会话 id、当前模型、切换感知

### 7.1 拿会话 id

会话作用域的 slot，`inject(sessionId)` 直接给：

```js
inject: (sessionId) => ({ /* 直接用 sessionId 建 per-session 座席 */ })
```

组件里也能拿到框架 props：`sessionId`、`useSession`、`useSessions`、`useProjection`（`InputBar` @ `dsh-client-ui-conversation/lib/client.js:21757`；`ChatView` @ `dsh-client-ui-chat/lib/client.js:3451`）。
`scope: "session"` 时 `sessionId` 一定有值；`"session-maybe"` 在新建会话（hero）时为 `undefined`（如 `conversation.composer.bar`，`conversation.content` 的 `inject: (sessionId) => ...`，`:22841`）。

会话摘要（cwd、是否空白等）走 `ctx.sessions.list`（`createSnapshotStore`）：

```js
const cwd = useSessions((s) => sessionId === void 0 ? void 0 : s.byId[sessionId]?.cwd);   // :20486
// 或非 React：
sessions.list.getSnapshot().byId[sessionId]?.cwd
```

### 7.2 拿当前模型选择

就是会话投影面 `modelSelection`（model-selection 包自己也这么读）：

```js
// @deepseek-ai/dsh-client-ui-model-selection/lib/client.js:1037
new ModelDirectory(this.ctx.remote.session, sessionId, () => sessions.subagentAddress(sessionId) === void 0,
                   this.catalog, binding.session.projections.faceOf("modelSelection"), ...)

// @deepseek-ai/dsh-client-ui-conversation/lib/client.js:16153-16156 一次读四个面
const model  = session.projections.faceOf("modelSelection").getSnapshot();
const plan   = session.projections.faceOf("plan").getSnapshot();
const goal   = session.projections.faceOf("goal").getSnapshot();
const agentPreset = session.projections.faceOf("agentPreset").getSnapshot();
```

在会话作用域组件里更简单：`const model = useProjection("modelSelection");`

已确认可用的投影面（grep `faceOf("...")` 全仓库）：`inbox`、`modelSelection`、`permissions`、`goal`、`plan`、
`agentPreset`、`workingDirectory`、`userQuestions`、`turnOutline`、`tokenUsage`、`sessionStats`、
`contextPressure`、`contextBreakdown`、`todos`、`imageLimits`、`title`。

**没有** `workspace` / `workspaces` 面 → 要么新增（host 侧声明投影），要么用自建 store + 事件。

### 7.3 感知会话切换

**没有** `session/switched`、`session/activate`、`session/open` 这类事件（已 grep 所有已解出的 client 包，零命中）。
实际机制是**作用域重建**：

- `conversation.content` 是 `registerFactory({ scope:"session-maybe", inject:(sessionId)=>({...}) })`（`:22799-22841`）；
- `conversation.composer.bar` 是 `single` + `session-maybe`，其 `inject` 里 `sessionId === void 0` 有专门分支（`:23000-23016`）；
- 模型座每次按 `sessionId` 新建 `ModelDirectory`（model-selection `:1037`）；
- agent-preset 为每个 session 建 `AgentPresetSeatController`，并在 `ctx.sessions.list.subscribe` 时重建（`:2887-2908`）。

→ **下拉框不需要自己监听切换**：放进 `conversation.input.right`（`scope:"session"`）后，切换会话时框架会用新的
`sessionId` 重新执行 `inject`，组件随之重挂；当前值从新会话的投影面/命令读即可。
另外：断线重连用 `ctx.on("connection/reset", refresh)`（goal、agent-preset、settings 都这么写）；
跨会话的全局视图用 `ctx.sessions.list.subscribe(...)`。

### 7.4 下拉框显示「当前工作台」的两种实现

1. **投影面（推荐，响应式）**：host 声明一个投影面（如 `workspace`），客户端 `const ws = useProjection("workspace")`，
   选择后 host 更新投影 → 所有读者自动刷新（权限档就是这么做的）。
2. **自建 store + 事件**：`sessions.binding(sessionId)?.session.command("/workspace " + id)` 后
   靠 `ctx.remote.$on("workspace/changed", ...)` 或本地乐观状态刷新（goal 的做法：本地 `pick` 状态 + 服务端事件）。

---

## 8. 不确定 / 需要验证的点（不要当成结论用）

1. **手写 typert manifest 能否通过**：`dsh-typert-generator` 不在 app.asar；loader 只校验 `{package, face, schemas, model, invocations}` 的形状，
   没有 generator 时是否还有别的校验（如 schema 引用、endpoint 冲突）**未实测**。→ 保险做法：不新增 RPC，走 settings + 会话命令。
2. **`conversation.input.right` 是否被未解出的包占用**：本次只覆盖了已解出的 40+ 个 client 包（全为空）。
   即便如此 `kind:"list"` 也允许并存，风险低。
3. **第三方 client 包能否用 `dsh-client-ui-primitives`**：官方文档明确**禁止**（`references/practices.md`），
   所以胶囊必须手写；`IconPlusOutlineRegular` 等图标同理（本报告里 agent-preset 用它，是因为它是内置包）。
   第三方应自带 SVG 或纯 CSS 图形。
4. **工具白名单如何「按会话」生效**：`ctx.tools.restrict()` 要求 `agent.ctx` 作用域，第三方插件如何取得该作用域**未验证**；
   更稳妥的路线是把「工作台」建模成 agent preset 的一个变体（预设本身就是工具组合）。
5. **截图里「⚙ 工作区内修改」的确切归属**：代码上 `conversation.input.permission` 由 permission-presets 注册，
   文案「工作区内/工作区外」来自权限档；但我不排除它还叠加了 plan 座席的渲染，未逐帧核对。
6. **客户端插件的生效时机**：`dsh.client.immediately` + HMR 可以热加载新 bundle，但**替换已安装包需要重启**
   （`references/host-plugin.md:83`：「replacing an installed package requires restart to load a fresh JavaScript module generation」）。

---

## 9. 最小改动面清单

### 9.1 方案 A：纯插件（不改任何发布包）——推荐

新增一个 workspace bundle，例如 `D:\PersonalFiles\PersonalProjects\dsh-toolset\packages\workspaces\`：

| 文件 | 作用 | 关键内容 |
|---|---|---|
| `package.json` | 清单 | `exports { ".", "./client", "./locale/*.json", "./icon" }`；`dsh.bundle.patch`；`dsh.client { platform:"web", immediately:true, inject:["@deepseek-ai/dsh-client-ui-conversation"] }` |
| `cordis.patch.yml` | host 插入 | `- insert: [{ id: workspaces, name: '@local/workspaces' }]` |
| `index.js` | host | `export const Config`（工作台列表 schema）；`export function apply(ctx, config)`：注册 `/workspace` 会话命令；按会话选择 `ctx.tools.restrict({allow})`（需 agent 作用域） |
| `client.js` | 浏览器 | ① `ctx.slots.register({name:"conversation.input.right", id:"workspace", order:10, locale:NS, inject:(sessionId)=>({...})}, WorkspaceChip)` ② `ctx.slots.register({name:"settings.section", id:"workspaces", order:18, label:()=>t("nav"), ...}, WorkspaceSection)` ③ 可选 `ctx.slots.register({name:"conversation.hero.options", ...})` |
| `locale/zh.json` 等 | 文案 + meta | `meta.title` / `meta.description`（插件市场/内置插件页要读） |
| `icon.svg` | 图标 | ≤256 KiB |

安装：`plugin_manager` 的 `install_bundle`（本会话已有该工具；**不要**用 shell 复刻安装步骤）。

### 9.2 方案 B：内置到 DSH 本体（若产品要「官方功能」）

| 包 | 改动 | 量级 |
|---|---|---|
| 新包 `dsh-workspaces`（host） | 工作台注册表 + 设置命名空间 + `/workspace` 命令 + 投影面 + typert `workspaces/list` | 中 |
| 新包 `dsh-client-ui-workspaces` | 下拉（`conversation.input.right`）+ 设置页（`settings.section` order 18） | 中 |
| `dsh-client-ui-conversation` | **不需要改** | 0 |
| `dsh-client-ui-model-selection` | **不需要改** | 0 |
| `dsh-client-ui-settings-general` | **不需要改**（导航自动按 order 排序） | 0 |

### 9.3 一句话评审结论

> 扩展点是**公开且够用**的：下拉框塞 `conversation.input.right`（已存在的空 list slot，正好在模型座左边），
> 设置页注册 `settings.section`（order 18）。客户端不用改任何现有包；
> 真正的工作量在 host 侧 —— 「工具白名单」只能通过 `ctx.tools.restrict()` 在 agent 作用域生效，
> 而它和 Agent 预设是同一层能力，建议先决定「工作台 = 预设变体」还是「独立机制」，再决定要不要写 typert 服务。
