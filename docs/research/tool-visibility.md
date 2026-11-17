# DSH 工具可见性 / 掩码层：源码调研报告

> 调研对象：`app.asar` 解出的 `@deepseek-ai/*` 生产 bundle（未混淆，带 JSDoc）。
> 解出根目录：`tmp/src/dsh/node_modules/@deepseek-ai/<包>/lib/*.js`（下文所有 `xxx/lib/index.js:N` 均相对该目录）。
> 本次额外解出的包：`dsh-llm-deepseek`、`dsh-mcp-client`（其余为已解出集合）。
> 调研方式：只读。未修改 `docs/` 下任何文件，未安装任何东西。

## 0. 结论速览

| # | 问题 | 结论 | 可行性 |
|---|---|---|---|
| 1 | `restrict(filter)` 语义 | allow/deny 都是掩码；同一 filter 内 deny 优先；多次调用取**交集**；返回 Cordis effect disposer，dispose 即解除且不残留 | — |
| 2 | 生效点 | 在 `tools.resolve()` → `definitions()` → system-prompt 组装阶段：被掩掉的工具**不进请求体 `tools` 数组**（真省 token），执行时也表现为 `UNKNOWN_TOOL` | YES |
| 3 | `toolSet`（step admission） | 每步由 agent-loop 的 `preStep` 调 `tools.resolve()` 现算；插件只能通过 restrict / `when` 条件 / 注册时机影响，**没有注入钩子** | CONDITIONAL |
| 4 | 拿 agent ctx 的时机 | `agents.create({setup})` 的 `setup(ctx)`（未发布态）或 `agent/created`（serial，被 await）；`agent/pre-step` 是 waterfall；清理靠 agent scope dispose | YES |
| 5 | 现成工具目录 API | **没有 `tools.list()`**；有 `view/definitions/schemas/get`（纯读）+ `agentPresets.acquireScope(id)` 取 preset 作用域；name/description 可单取；**来源不落盘**，只能靠层归属与 `mcp__<server>__<tool>` 命名 | CONDITIONAL |
| 6 | 拒绝时模型看到什么 | `content:[{type:'text',text:"Error: <reason>"}]`, `isError:true`；guard 的返回值原样做 reason；无 i18n key | — |
| 7 | tools 数组 | 请求体顶层 `tools:[{name,description,input_schema,defer_loading?}]`；顺序由 `orderTools` 决定（默认按 name 字典序，可被 `Config.toolOrder` 覆盖）；估算 `ceil(JSON_len/4)+4` | — |
| 8 | 「preset 作用域注册的工具对 restrict 免疫」 | **不正确**。preset 的 generation scope 是 agent scope 的**父**（`bindScopeParent`），属于「继承/祖先」工具，**会被掩掉**。真正免疫的只有「查看者自身那一层」（agent setup scope 注册的工具） | NO |

一句话总览：`restrict` 是一个**按 scope 叠加的可见性过滤器**，作用点在「每次步骤开始的工具解析 + system-prompt 组装」，不是在执行器；被掩掉的工具既不在 `tools` 数组里，也无法被调用，模型看到的是 `unknown tool`。

---

## 1. `restrict(filter)` 的完整语义与作用域链

### 1.1 数据结构：每层一个 `restrictions` 列表

`dsh-tools/lib/index.js:381-396`

```js
var ToolLayer = class {
	constructor(scope) {
		this.scope = scope;
		this.tools = new NamedEntries(...);
		this.restrictions = new AnonymousEntries();
	}
	admits(name) {
		for (const filter of this.restrictions.values()) if (filter.allow !== void 0 && !filter.allow.has(name) || filter.deny !== void 0 && filter.deny.has(name)) return false;
		return true;
	}
};
```

要点：

- `restrictions` 是 `AnonymousEntries`（无序、按插入追加），**一层可挂多条 filter**。
- `admits()` 对同一层里**所有** filter 做 AND：任何一条不允许 → `false`。
- 单条 filter 内部：先看 `allow`（不在 allow 集合 → 拒绝），再看 `deny`（在 deny 集合 → 拒绝）。所以 **deny 优先于 allow**；`allow` 与 `deny` 同时给时语义是 `allow ∖ deny`。

### 1.2 `restrict()` 本体

`dsh-tools/lib/index.js:446-468`

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
		const allow = filter.allow;
		const deny = filter.deny;
		if (allow === void 0 && deny === void 0) throw new Error("tools.restrict({}) is a no-op: pass `allow` and/or `deny` (an empty filter is almost always a materialized-empty-config bug)");
		const compiled = {
			...allow !== void 0 ? { allow: new Set(allow) } : {},
			...deny !== void 0 ? { deny: new Set(deny) } : {}
		};
		if ([...allow ?? [], ...deny ?? []].includes("run_code")) throw new Error(`tools.restrict() cannot name reserved PTC mode presentation transport "${RUN_CODE_NAME}"; restrict end-capability tools instead`);
		const known = this.view(scope).restrictableNames;
		const unknown = [...allow ?? [], ...deny ?? []].filter((name) => !known.has(name));
		if (unknown.length > 0) throw new Error(`tools.restrict() names unknown global tool${unknown.length > 1 ? "s" : ""} ${unknown.map((n) => `"${n}"`).join(", ")}; known global tools: ${[...known].sort().join(", ") || "(none)"}`);
		return this.layers.effect(this.ctx, (layer) => layer.restrictions.append(compiled), { label: "tools.restrict()" });
	}
```

逐条：

1. **必须 scoped ctx**：`scopeOf(this.ctx)` 为 `undefined` 直接抛错（全局 ctx 上调用会把所有 agent 都掩掉，作者显式禁止）。
2. **空 filter 报错**：`{}` 不接受，`allow: []` 则是合法的（= 全部掩掉，因为任何名字都不在空集合里）。
3. **`run_code` 是保留名**：既不能注册（`register()` 里 `if (name === "run_code") throw ...`，`dsh-tools/lib/index.js:440`），也不能出现在 allow/deny 里。
4. **名字必须先存在**：校验集是 `view(scope).restrictableNames`——只有「已注册且可被掩掉的（继承）名字」才算已知。给一个当前没注册的名字（比如还没挂载的 preset 的工具）会抛错。
5. **叠加**：每次调用 `restrictions.append(compiled)`，即**新增一层 AND 条件**；多次调用 = 交集，不是替换。
6. **返回值**：`this.layers.effect(...)` 的返回值 —— Cordis effect disposer（幂等函数），dispose 后该条 filter 被移除。

### 1.3 `ScopedLayers.effect`：disposer 与「不残留」

`dsh-scope/lib/index.js:182-218`

```js
	effect(ctx, action, options) {
		const scope = scopeOf(ctx);
		const notify = options.notify ?? true;
		return ctx.effect(function* () {
			let layer;
			let created = false;
			if (scope === void 0) layer = this.global;
			else {
				const existing = this.scoped.get(scope);
				if (existing === void 0) {
					layer = this.createLayer(scope);
					this.scoped.set(scope, layer);
					created = true;
				} else layer = existing;
			}
			let undo;
			try {
				undo = action(layer);
			} catch (error) {
				if (scope !== void 0 && created && layer.isEmpty()) this.scoped.delete(scope);
				throw error;
			}
			yield () => {
				undo();
				if (scope !== void 0 && layer.isEmpty()) this.scoped.delete(scope);
				if (notify) this.onChange();
			};
			if (notify) this.onChange();
		}.bind(this), options.label);
	}
```

- 传进 `action` 的 layer 由 `scope` 唯一决定，`action` 返回的是「撤销这一个条目」的同步 undo（`AnonymousEntries.append` 用一个 `Symbol()` 作 key，见 `dsh-scope/lib/index.js:91-124`）。
- dispose 顺序：`undo()`（移除该 filter）→ 若该层已空则从 `this.scoped` 里删掉整个 layer → 触发 `onChange`。
- **因此「先 dispose 再建」不会残留**：dispose 后该 agent 层要么被整个删除，要么只剩别的注册（restrictions 为空），再来一次 `restrict()` 得到的是全新的一条 filter。
- 反过来，**不 dispose 直接再 `restrict()` 就是叠加**（交集），这正是「掩码残留」老 bug 的来源。
- `onChange` 默认 `true`，映射到 `ToolsService` 构造器里的 `() => { this.ctx.emit("tools/change") }`（`dsh-tools/lib/index.js:410-412`）。即每次 restrict/register/卸载都会广播 `tools/change`（本次解出的包里没有该事件的监听者，preset registry 会自己 `emit` 一次，见 `dsh-agent-preset-registry/lib/index.js:753`）。

### 1.4 作用域链怎么走

- epoch key 就是 **agent 对象本身**：`dsh-agent-loop/lib/index.js:543-544`
  ```js
  this.scope = createScope(loopCtx, this);
  this.ctx = this.scope.ctx;
  ```
  `createScope` 把 `kScope` 符号打进子 ctx：`dsh-scope/lib/index.js:296-306`；`scopeOf(ctx) => ctx[kScope]`（`:312-314`）。
- 父链：`scopeParents` WeakMap + `scopeChainOf(key) => [key, parent, grandparent, …]`（nearest-first，`dsh-scope/lib/index.js:276-280`）。
- 叠层顺序：`chainLayers(scope)` 用 `scopeChainOf(scope).reverse()` —— **最远祖先在前、自身最后**（`dsh-scope/lib/index.js:162-169`）。
- `peek(scope)` 只看**精确**一层、不 chain（`:151-154`），restrict 的「自身豁免」就是靠它实现的（见第 2 节）。
- agent 的实际链：
  - 有 preset 的 agent：`agent → preset generation scope`（`bindScopeParent(agentKey, generationKey)`，`dsh-agent-preset-registry/lib/index.js:684-696`）；
  - 无 preset：只有自己一层；
  - **子 agent**：`composeFrom(childCtx, parent.ctx)` 让子 agent 也 join 到**同一个 generation**（`:717-727`），所以子 agent 的链是 `child → generation`，**父 agent 那一层不在里面** → 父 agent 上的 restrict 不会传染给子 agent（子 agent 的掩码由 `toolFilter` 单独下，见 1.6）。

### 1.5 谁被掩：inherited vs own

`dsh-tools/lib/index.js:469-508`

```js
	view(scope) {
		const layers = this.layers.chainLayers(scope);
		const own = this.layers.peek(scope);
		const inherited = new Map(this.layers.global.tools.entries());
		for (const layer of layers) {
			if (layer === own) continue;
			for (const [name, registration] of layer.tools.entries()) inherited.set(name, registration);
		}
		const visible = new Map();
		const registrations = new Map();
		const knownNames = new Set();
		const restrictableNames = new Set();
		for (const [name, registration] of inherited) {
			knownNames.add(name);
			restrictableNames.add(name);
			if (layers.every((layer) => layer.admits(name))) {
				visible.set(name, registration.definition);
				registrations.set(name, registration);
			}
		}
		if (own !== void 0) for (const [name, registration] of own.tools.entries()) {
			knownNames.add(name);
			visible.set(name, registration.definition);
			registrations.set(name, registration);
		}
		return { visible, registrations, knownNames, restrictableNames };
	}
```

- `inherited` = **全局层 + 所有祖先层**（含 preset generation layer），后面的覆盖前面的（shadow）。
- `restrictableNames` = `inherited` 的键 → 只有这些名字能被 `restrict` 点名。
- `visible` = `inherited` 中满足 `layers.every(layer => layer.admits(name))` 的 + `own` 层**无条件**加入。
- 结论（JSDoc 原文，`:469-473`）：「Restrictions across the scope chain intersect over inherited global and ancestor tools; **the viewing scope's own registrations remain exempt**.」

### 1.6 官方用例：`dsh-subagent` 的 `toolFilter`

- 声明与解析：`dsh-subagent/lib/index.js:591, 614-625`
  ```js
  /** ... */
  if (!isRecord(value)) throw new Error("persisted subagent descriptor toolFilter must be an object");
  assertKnownKeys(value, TOOL_FILTER_KEYS, "toolFilter");
  if (allow === void 0 && deny === void 0) throw new Error("persisted subagent descriptor toolFilter must declare allow and/or deny");
  ```
- 应用（子 agent 的 setup ctx）：
  ```js
  // dsh-subagent/lib/index.js:385-397
  function applyChildOverrides(childCtx, composition) {
      childCtx.systemPrompt.context({ /* ... */ });
      if (composition.persona !== void 0) childCtx.systemPrompt.section({ /* ... */ });
      if (composition.toolFilter !== void 0) childCtx.tools.restrict(composition.toolFilter);
  }
  ```
- 同一处还演示了 `guard` 与「自身层注册」的配合：`dsh-subagent/lib/index.js:914`（`childCtx.tools.register({...structured_output})`）、`:945`
  ```js
  childCtx.tools.guard((exec) => captured === void 0 && pending === void 0 ? void 0 : `structured output already recorded: the run is complete, so \`${exec.name}\` is not executed`);
  ```
  注意 `register` 与 `restrict` 都在**同一个** childCtx 上：`structured_output` 落在 own 层 → 即使 allow 名单里没有它也照样可见（own 豁免）；而 `guard` 是另一条正交的拒绝通道。

### 1.7 掩码该挂在哪个 scope：三种落点

| 挂点 | 影响面 | 能掩谁 | 能否掩 preset 自己的工具 |
|---|---|---|---|
| `agent.ctx`（会话） | 单个 agent | 全局层 + 祖先层（preset） | 能（因为预设层是祖先） |
| preset generation ctx（在 preset 组合里某个插件内） | 该 preset 的所有会话 | 全局层 | **不能**（generation 的 own 层豁免自己） |
| 无 scope 的普通插件 ctx | 全局 | — | 被硬性禁止（`restrict()` 抛错） |

第二行是本次调研顺带发现的可用模式：`view(generationKey)` 的 `own` 就是 generation 层，所以「在 preset 内部 restrict」只能掩全局工具，天然掩不到自己声明的工具——与第 8 节的结论互为镜像。

---

## 2. 生效点：到底在哪一步被过滤

### 2.1 调用链（唯一一条）

1. **每步开始**：`dsh-agent-loop/lib/index.js:666-713`
   ```js
   const toolSet = await this.loopCtx.tools.resolve({ agent: this, modelSelection: selection, signal });
   try {
       const assembly = await this.loopCtx.systemPrompt.assemble({ ...assembleContextFor(this, signal), modelSelection: selection, toolSet });
   ```
   `tools.resolve()` 全仓库**只有一个调用点**（grep `tools.resolve(` 命中 `dsh-agent-loop/lib/index.js:673`）。
2. **system-prompt 组装**：`dsh-system-prompt/lib/index.js:358-413` 收集所有 tool provider（`this.layers.global.toolProviders` + 各 scope 的），每个 provider 返回 `{ schemas }`：
   ```js
   const acceptedKnownNames = result.knownNames ?? schemas.map((tool) => tool.name);
   ...
   const tools = orderTools(collected, this.toolOrder, knownNames);
   ```
3. **ToolsService 作为 provider**：`dsh-tools/lib/index.js:418-424`
   ```js
   ctx.systemPrompt.tools(({ scope, toolSet }) => {
       const description = this.selectExecutor(scope).describe(this.definitions(scope, toolSet));
       return { ...description, knownNames: description.knownNames ?? [...this.view(scope).knownNames] };
   });
   ```
4. **definitions → view**：`dsh-tools/lib/index.js:579-581`
   ```js
   definitions(scope, toolSet) {
       return toolSet === void 0 ? [...this.view(scope).visible.values()] : [...toolSet.view(scope).values()];
   }
   ```
5. **schema 投影**：`dsh-tool-executor-native/lib/index.js:12-14` → `projectToolSchema(definition, false)`，再在 system-prompt 里被裁剪成 `{name, description, parameters, deferLoading?}`。
6. **进请求体**：`dsh-agent-loop/lib/index.js:1018-1025`
   ```js
   const header = canonicalHeader({ config, ...preparedCall === void 0 ? {} : { adapterDefaults: preparedCall.adapterDefaults }, ...tools.length > 0 ? { tools } : {} });
   ```
   再由 adapter 映射成 provider 的 `tools` 字段（见第 7 节）。

### 2.2 被 restrict 掉的工具：是彻底消失，还是执行时拒绝？

**彻底消失。** 两处都不再出现：

- **请求体 `tools` 数组**：`definitions()` 只返回 `view/toolSet.view` 的 `visible`，被掩的名字不在里面，`projectToolSchema` 也就没机会产生它。因为 `canonicalHeader` 只收 `tools`，请求体里没有第二处工具清单。
- **system prompt 文本**：DSH 的工具声明**根本不写进 prompt**。`dsh-system-prompt/lib/index.js:350-356` 的 JSDoc 明确：「Sections, tools, and interpolation variables ... prompt section; **tool declarations stay provider-owned**」，`assemble()` 的返回值把 `tools` 和 `sections` 分成两个字段（`:401-412`）。所以「从提示词里的工具清单消失」这句在本架构里是**空真**：提示词里从来没有清单。
  - 但**有例外**：插件自己写的、与某个工具绑定的 prompt section（如 `tool:subagent`、`tool:structured_output`）不会因为 `restrict` 自动消失。`dsh-tool-subagent/lib/index.js:503-508` 演示了正确写法——section 的 `text(context)` 里用可见性自行收口：
    ```js
    const visible = [...delegationTools].filter((tool) => ctx.tools.get(tool.name, context.scope) === tool).map((tool) => tool.name).sort();
    if (visible[0] !== toolName) return "";
    ```
    即：**省 token 的收益 = 工具 schema 的字节数（确定） + 第三方 section 是否自觉收口（不确定）**。
- **执行时**：被掩的工具不在 `visible` 里，`executable()` 返回 `undefined`（`dsh-tools/lib/index.js:530-534`），实际报 `ToolNotFoundError` → `UNKNOWN_TOOL`（见第 6 节）。也就是说模型如果凭记忆硬调，会拿到 `unknown tool "x"`，**和拼错名字无法区分**——没有「该工具被策略屏蔽」这种专门错误。

### 2.3 中途改变掩码会怎样（重要）

- `resolve()` 返回的 `toolSet` 是**活视图**：`view(scope)` 每次都重新 `this.view(agent)`，并只保留「定义对象与注册记录都还是原来那个」的项（`dsh-tools/lib/index.js:555-572`）。所以：
  - 掩码在**同一轮内**被改：下一次调用立刻按新集合判定；已经派发的调用不受影响（README.zh.md:71 有同样的表述）。
  - 注册被卸载：`current.visible.get(name) === definition` 不成立 → 该名字从 toolSet 里消失。
- **请求头会变化并通知模型**：`dsh-agent-loop/lib/index.js:1036-1064`，工具集合变化会 append 新的 `request/header`（`reason: "change"`），并追加一条 `developer/message`：
  ```js
  const additions = tools.filter((tool) => !previousNames.has(tool.name)).map((tool) => ({ type: "tool-addition", toolName: tool.name }));
  const removals = (baseline.tools ?? []).filter((tool) => !currentNames.has(tool.name)).map((tool) => ({ type: "tool-removal", toolName: tool.name }));
  if (additions.length > 0 || removals.length > 0) session.append("developer/message", { ...position, message: createDeveloperMessage({ source: { kind: "tool-registry" }, content: [...additions, ...removals] }), ... });
  ```
  即中途换掩码不是免费的：会多一条 developer message（但这是必要的，否则模型会继续用旧记忆调用）。

---

## 3. `toolSet`（step admission）是什么、谁算、插件能否影响

### 3.1 定义

`dsh-tools/lib/index.js:535-572`（`resolve`）

```js
	async resolve(context) {
		const { agent, signal } = context;
		signal.throwIfAborted();
		const view = this.view(agent);
		...
		return Object.freeze({
			dispose: () => { closed = true },
			view: (scope) => {
				if (closed || scope !== agent) return /* 空 Map */;
				const current = this.view(agent);
				/* 只保留定义与注册记录都未变的项 */
			}
		});
	}
```

- 它是**一次步骤独占的已准入集合**（JSDoc 与 README 都叫 "step admission" / `ResolvedToolSet`），包含「此刻可见 **且** `when` 条件求值为真」的名字。
- 生命周期：`preStep` 里创建，`try` 结束时成功的走 `decision.toolSet` 传给 `tools.execute(...)`（`:959-971`），失败或 reject 时 `toolSet.dispose()`（`:699-711`）；批次结束后释放。
- `dispose()` 之后 `view()` 恒返回空 → 迟到的调用变成 `UNKNOWN_TOOL`（README.zh.md:71 原文：「批次没有已解析集合时，条件工具调用返回 `UNKNOWN_TOOL`」）。

### 3.2 条件工具（`when`）

- 注册时声明：`register(definition, { when })` → 存进 `{ definition, when }`（`dsh-tools/lib/index.js:441-444`）。
- 解析时求值：`resolve()` 里对每个可见名 `enabled = registration?.when === void 0 || await registration.when(context)`，`context` = `{ agent, modelSelection, signal }`；抛错 → `ToolActivationError`（`shared-DTdn5dXO.js:554-563`，message `cannot resolve availability of tool "x"`）。
- 这解释了 `get(name, scope, toolSet)` 的三态：有 `toolSet` 时查准入集合；没有时对带 `when` 的工具返回 `undefined`（`dsh-tools/lib/index.js:519-534`）。

### 3.3 插件能影响哪一段

能：

- `tools.restrict(...)`（可见性，见第 1 节）；
- `tools.register(def, { when })`（条件准入）；
- 在步骤开始前 `register` / dispose 掉注册；
- 通过 `agentPresets.select()/mount()` 换 preset（会 `emit("tools/change")`，`dsh-agent-preset-registry/lib/index.js:750-758`）。

不能：

- **没有**任何 waterfall/事件可以「注入或过滤一个 toolSet」。`agent/pre-step` 这个 waterfall 虽然带 `agent`，但它在 `resolve()` + `assemble()` **之后**才跑（`dsh-agent-loop/lib/index.js:685-697`），返回值只用于 `messages`/`kind`，`assembly` 已经定型（`:703-708` 把 `assembly` 一起返回，且 `decision` 里没有 tools 字段）。
- 没有 `tools.setToolSet` 之类的写入口（grep `tools.resolve(` 只有一处调用；`ToolsService` 的公开方法就是 register/restrict/view/get/executable/definitions/schemas/setExecutor/execute/guard/checkGuards/resolve）。

### 3.4 「工作台选择能否挂在会话上」

可以，但落点是 **agent ctx 上的 restrict**，不是 toolSet：

- 每个 agent（= 每个会话）有独立 scope，`restrict` 只影响这一个 agent；
- 会话内切换 = `dispose` 旧的 + `restrict` 新的（第 1.3 节保证不残留）；
- 子 agent 不受影响（父层不在子的链上），要管就显式下 `toolFilter`；
- 持久化要自己写（`session.append(...)` 之类），框架不会替你记「这个会话选了哪个工作台」——目前只有 `agent-preset/selected` 是框架级记录（`dsh-agent-preset-registry/lib/index.js:776`）。

---

## 4. 插件何时拿到当前 agent 的 ctx；为什么必须 scoped；如何清理

### 4.1 三个时机

| 时机 | 形态 | 签名 | 能否注册 effect（restrict/guard） |
|---|---|---|---|
| 创建期（未发布） | `options.setup` | `setup(ctx)`，`ctx` 即 agent 的 scope ctx | 能，且最推荐 |
| 创建后广播 | `agent/created`（**serial，被 await**） | `{ agent, source, signal? }` | 能（用 `agent.ctx`） |
| 每步 | `agent/pre-step`（waterfall） | `{ messages, turn, step, signal, modelSelection }` | 能，但对本步工具集合**为时已晚** |

证据：

- `dsh-agent/lib/index.js:573-587`（`agents.create`）
  ```js
  * @param options - shared identity, optional live parent, session seed/metadata, and agent options.
  * @returns the handle after setup, rollback-covered publication, and loop start complete.
  */
  async create(options) { ... return Reflect.apply(target.createAgent, receiver, [ownerCtx, options]); }
  ```
  preset registry 的 JSDoc 直接把 setup 参数命名为 agent 上下文：「@param ctx Agent context **from its setup callback**」（`dsh-agent-preset-registry/lib/index.js:697-702`）。
- `dsh-agent/lib/index.js:703-719`（`announce`）：
  ```js
  await this.ctx.serial(entry.carrier, "agent/created", { agent: entry.agent, source, ...signal === void 0 ? {} : { signal } });
  ```
  carrier 是 `scopeTarget(agent, agent)`（`:644`），listener 失败会让创建失败（JSDoc `:601-609`：「Rejects if the id is already registered or a serial `agent/created` listener fails」）——所以这是「创建时打补丁」的可靠挂点，且**早于第一轮**。
- `agent/pre-step`：`dsh-agent-loop/lib/index.js:685-697`（waterfall，见 3.3，跑在 assemble 之后）。
- `agent/disposed`：`dsh-agent/lib/index.js:678-692`，payload `{ agent }`，**非 serial**（dispatch + warn），只适合日志。

### 4.2 为什么必须在 `agent.ctx`

- layer 的键就是 `scopeOf(ctx)`；`restrict` 把它挂到「调用者 ctx 所属的那一层的 restrictions」。拿一个普通插件 ctx（无 scope）调用 → 命中 `scope === undefined` 的守卫直接抛错（`dsh-tools/lib/index.js:454-455`）。
- 反过来说，用 `agent.ctx` 调用的效果是：**只对这一个 agent 生效，且随 agent scope 一起销毁**。

### 4.3 清理

- `restrict` 返回的 disposer 来自 `ctx.effect(...)`，注册在 agent scope 的 effect 树上。
- agent 销毁时：`dsh-agent-loop/lib/index.js:1475-1496` → `await machine?.scope.dispose()`，agent scope 内所有 effect（含每条 restrict）被撤销。
- 因此：
  - **会话结束/切换 → 不用手动清**，不同会话是不同 agent、不同 scope；
  - **同一个会话内换工作台 → 必须手动 dispose 旧的**，否则叠加成交集（第 1.3 节）。
  - 还有一条兜底：`ScopedLayers.effect` 在 dispose 时若层空会 `this.scoped.delete(scope)`，不会留下空层。

---

## 5. 有没有现成的「工具目录」能力

### 5.1 没有 `tools.list()`

`ToolsService` 的公开面（`dsh-tools/lib/index.js:404-663`）：`register / restrict / view / get / executable / resolve / definitions / schemas / setExecutor / execute / guard / checkGuards`。**没有** `list()`、没有 `names()`、没有 per-tool 的 `source` 元数据。`dsh-tools/lib/types/index.js` 里也没有 remote/typert 暴露（grep `remote|Remote|@typert` 无命中）——即这个服务**没有对 UI/远程的 API 面**，只能在 in-process 里读。

### 5.2 但「只读目录」完全够用，且不会把工具装进 tools 数组

读 API 都是纯查询（不注册、不改请求）：

```js
// dsh-tools/lib/index.js:519-534
get(name, scope, toolSet) {
    return toolSet === void 0 ? this.view(scope).visible.get(name) : toolSet.view(scope).get(name);
}
executable(name, scope, toolSet) { ... }
```

- `ctx.tools.view(scope)` → `{ visible, registrations, knownNames, restrictableNames }`
  - `knownNames` = **掩码前**的全部已知名字（含被隐藏的）→ 目录要「连隐藏的也列出来」就用它；
  - `visible` = 掩码后；
  - `registrations` 里带 `when`，可以标注「条件工具」。
- `ctx.tools.definitions(scope, toolSet?)` → 定义对象数组；
- `ctx.tools.schemas(scope, toolSet?)` → 已投影的 `{name, description, parameters, deferLoading?}`（`dsh-tools/lib/index.js:589-591`）。
- `scope` 传 `undefined` = 全局视图（只有 host/global 层，`chainLayers(undefined)` 为空）。

**要看某个 preset 作用域里的工具**（即使当前没有 agent 在用）：

```js
// dsh-agent-preset-registry/lib/index.js:787-803
async acquireScope(id) {
    const generation = await this.retain(id);
    ...
    return { key: generation.key, [Symbol.asyncDispose]: async () => { ... } };
}
```
拿到 `key` 后直接 `ctx.tools.definitions(key)` / `view(key)`（`key` 就是 scope key，`scopeOf` 的同一个东西）。这是官方「冷 transcript 渲染」路径，读完后 `await using` 释放租约即可。

### 5.3 name / description / inputSchema 分别在哪

- 都在 defineTool 的规范形态里：`dsh-tools/lib/index.js:310-376`
  ```js
  function projectToolSchema(definition, detachParameters) {
      return {
          name: definition.name,
          description: definition.description,
          parameters: detachParameters ? structuredClone(definition.parameters) : definition.parameters,
          ...definition.deferLoading === true ? { deferLoading: true } : {}
      };
  }
  ```
- `definition.description`：字符串（模型看到的那段）；
- `definition.parameters`：**已经是 JSON Schema**（`defineTool` 里由 `parameterSchemaSpecToJsonSchema` 编译，`:347-359`）；
- `definition.output`：`{ schema, render, presentationMeta? }`（不进请求体）；
- `definition.deferLoading`：布尔（见第 7 节）。
- **只取 name+description** 完全可以：直接读 `definition.name` / `definition.description`，或 `schemas()` 后丢掉 `parameters`。零成本。

### 5.4 「来源」这一维没有元数据

- `register()` 只存 `{ definition, when }`（`dsh-tools/lib/index.js:441-444`），**不记录来源包 / 插件 id / MCP server**。
- 能推断的只有两条线索：
  1. **层归属**：全局层（host 级）vs 某 preset generation 层（preset 级）vs 某 agent 的 own 层（agent 级）；
  2. **命名约定**：MCP 工具名固定为 `mcp__<serverName>__<rawName>`（`dsh-mcp-client/lib/index.js:58, 86-97`，注册在 `:153` `ctx.tools.register(definition)`）。
- 若目录要显示「属于哪个包」，只能自己做：在掩码插件的配置里维护 mapping，或在 `ctx.tools.register` 外层包一层（但那是改别人的注册，不现实）。**建议按「层 + 名字前缀」推断**。

### 5.5 其他可用的「目录」信号

- `tools/change` 事件（`dsh-tools/lib/index.js:410-412`）：只告诉你「变了」，不带 payload；
- `ctx.systemPrompt.tools(provider)`（`dsh-system-prompt/lib/index.js:295-302`）：是**贡献**工具，不是读取；
- 没有任何事件会列出注册项。

---

## 6. 被 restrict / guard 拒绝时模型实际收到什么

### 6.1 guard 拒绝（以及 `tools/pre-execute` waterfall 的 `deny`）

`dsh-tools/lib/pipeline.js:402-418`

```js
const denialReason = decision.kind === "allow" ? this.tools.checkGuards(exec) : decision.reason;
const denialInfo = decision.kind === "deny" ? decision.info : void 0;
if (denialReason !== void 0) return {
    kind: "post-result",
    exec,
    result: this.materializeFinalResult({
        content: [{ type: "text", text: `Error: ${denialReason}` }],
        isError: true,
        error: { message: denialReason, ...denialInfo === void 0 ? {} : { info: denialInfo } }
    })
};
```

- 模型看到的就是一段文本：`Error: <denialReason>`，`isError: true`。
- `denialReason` 是 **guard 函数返回的那个字符串原样**（`checkGuards` 返回第一个非 `undefined` 的 reason，`dsh-tools/lib/index.js:657-662`）；`tools/pre-execute` waterfall 的 `deny` 则用 `decision.reason`。
- **没有 i18n key**：`dsh-tools/locale/zh.json` 只有 `meta.title/description`（6 行），`en.json` 41 B；整个拒绝路径没有任何 `t(...)`/message key。
- 现实文案样例：`dsh-subagent/lib/index.js:945` 的 `structured output already recorded: the run is complete, so \`${exec.name}\` is not executed`；approval 拒绝走 `dsh-user-approval` 自己的 reason 字符串。

### 6.2 工具不存在 / 被掩掉

`dsh-tools/lib/pipeline.js:468-469` → `throw new ToolNotFoundError(exec.name)`；错误本体：

```js
// dsh-tools/lib/shared-DTdn5dXO.js:575-586
var ToolNotFoundError = class extends HarnessError {
	constructor(toolName, reachableFrom) {
		super(reachableFrom === void 0 ? `unknown tool "${toolName}"` : `unknown tool "${toolName}": ${reachableFrom}`, "UNKNOWN_TOOL");
		this.name = "ToolNotFoundError";
	}
};
```

再经 `toolErrorResult` 投影（`pipeline.js:850-864`）：

```js
function toolErrorResult(error) {
	const info = errorInfo(error);
	const message = toolErrorMessage(error);
	return { content: [{ type: "text", text: `Error: ${message}` }], isError: true, error: { message, ...info ? { info } : {} } };
}
```

- 模型看到 `Error: unknown tool "univer_sheet_write"`。
- `error.info` = `{ name, code }`（`errorInfo`，仅对 `HarnessError`，`pipeline.js:836-845`）——**这是内部元数据，不进入文本**；UI/日志能区分 `UNKNOWN_TOOL`，模型不能。
- `reachableFrom` 目前只在「名字可见但呈现层不允许直调」时使用（如 PTC 的 `run_code` 包装），掩码路径不传。

### 6.3 两者的差别（对设计有影响）

| 通道 | 模型可见文案 | 何时触发 |
|---|---|---|
| `restrict` | `unknown tool "x"` | 工具被掩 → 不在 schema 里 → 模型硬调才触发 |
| `guard` | `Error: <自定义 reason>` | 工具可见但调用被策略拒 |
| `tools/pre-execute` deny | `Error: <decision.reason>` | 审批/策略 |
| `when` 条件为假 | 不出现（resolve 阶段就没准入） | — |

`guard` 是唯一能给出**人话解释**的通道；`restrict` 只能给「不存在」。

---

## 7. `tools` 数组的位置、顺序、token 量级

### 7.1 请求体位置

DeepSeek Messages 路由：`dsh-llm-deepseek/lib/index.js:1727-1744`

```js
const system = [options.system, historySystem].filter(Boolean).join("\n\n");
return {
    model: options.model,
    stream: true,
    messages,
    max_tokens: ...,
    thinking: { type: effort === "off" ? "disabled" : "enabled" },
    ...effort === "off" ? {} : { output_config: { effort } },
    ...system.length === 0 ? {} : { system },
    ...options.temperature === void 0 ? {} : { temperature: options.temperature },
    ...options.stop === void 0 ? {} : { stop_sequences: options.stop },
    ...options.tools === void 0 ? {} : { tools: options.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
        ...tool.deferLoading === true ? { defer_loading: true } : {}
    })) }
};
```

- `tools` 是**请求体顶层字段**（与 `system`、`messages` 平级），不是 message 的一部分。
- 每个工具就是 **name + description + input_schema**，没有别的字段（`output`/`render`/`presentationMeta` 全在宿主侧）。
- `system` 也是顶层字符串：所以「工具清单消失省的是 `tools` 数组的 token，不是 prompt 的」。

### 7.2 顺序规则（谁排序）

`dsh-system-prompt/lib/index.js:85-97`

```js
function orderTools(tools, toolOrder, knownNames) {
	if (tools.find((tool) => tool.name === "<unlisted-tools>") !== void 0) throw new Error(`tool provider returned reserved tool name "<unlisted-tools>" (reserved for toolOrder's rest entry)`);
	if (toolOrder === void 0) return tools.sort(compareToolNames);
	const unknown = toolOrder.filter((name) => name !== "<unlisted-tools>" && !knownNames.has(name));
	if (unknown.length > 0) throw new Error(`toolOrder lists unregistered tool${unknown.length > 1 ? "s" : ""} ${...}`);
	const listed = new Set(toolOrder);
	const rest = tools.filter((tool) => !listed.has(tool.name)).sort(compareToolNames);
	return toolOrder.flatMap((name) => name === "<unlisted-tools>" ? rest : tools.filter((tool) => tool.name === name));
}
```

- 默认：**按 name 的 code-unit 字典序**（`compareToolNames`，`:106-109`）。
- 可配：`Config.toolOrder`（`dsh-system-prompt/lib/index.js:221-229`），必须包含 `<unlisted-tools>` 作为「其余工具」的插入位；未列出的按字典序插进去。
- 校验用的是 `knownNames`（**掩码前**），所以「配了顺序但当前被掩掉的工具」不会报错——`:86-87` 注释原文：「Unknown configured names fail; **known but restricted names may be absent.**」
- 顺序敏感：`headerEquals` 逐项按顺序比较（`dsh-session/lib/index.js:613-627`，`sameSchema = JSON.stringify(a) === JSON.stringify(b)`），顺序变了会被当成新请求头（`reason: "change"`）。

### 7.3 token 量级

`dsh-token-meter/lib/types/estimate.js:9-13, 90-94`

```js
const CHARS_PER_TOKEN = 4;
const BLOCK_OVERHEAD = 4;
export const ROLE_OVERHEAD = 4;

export function estimateToolsTokens(header) {
    if (header?.tools === undefined || header.tools.length === 0) return 0;
    return Math.ceil(JSON.stringify(header.tools).length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;
}
```

- 估算 = `ceil(JSON 字节数 / 4) + 4`。
- 单个 DSH 工具的 JSON（`{"name":..,"description":..,"parameters":{..}}`）量级：短工具（如 `read`）约 250–400 字符 → **65–100 token**；带大 schema 的（`subagent`、`univer_*`、`workflow`）800–2500 字符 → **200–630 token**。
- 64 个 host 工具按平均 400 字符估 ≈ 6400 token 量级；按平均 800 字符 ≈ 13k token。**这是掩码能省下的真实额度**（每次请求都省，且随轮次线性累积）。
- 另一条内置节流：`deferLoading`。`dsh-llm/lib/index.js:786-806`
  ```js
  // Explicitly deferred baseline tools become available only after their first retained addition.
  if (tools?.some((tool) => tool.deferLoading === true)) immediateTools = tools.map(({ deferLoading: _loading, ...tool }) => tool);
  ```
  即「声明了但首轮不发给模型，等第一次被加入（tool-addition）后才可用」。adapter 侧对应 `defer_loading: true`（`dsh-llm-deepseek/lib/index.js:1742`）。这是官方版的「按需装载」，但它是**注册时**决定的，插件仍可用来做懒加载。

---

## 8. 校验文档结论：「restrict 只作用于 agent 继承的全局工具，preset 作用域注册的工具对它免疫」

出处：`docs/DECISIONS.md:254`。

### 8.1 判定：**不正确**（结论对不上代码）

正确的边界是 **「查看者自身那一层（own layer）免疫」**，不是「preset 作用域免疫」。而 preset 注册的工具**恰恰在 own 之外**。

证据链：

1. preset 的插件组合被挂在 **generation scope**，agent 把它绑成**父**：

   `dsh-agent-preset-registry/lib/index.js:684-696`
   ```js
   join(ctx, key, generation) {
       const binding = { parent: bindScopeParent(key, generation.key), generation };
       generation.users++;
       this.bindings.set(key, binding);
       ctx.effect(() => async () => { ... }, "agent-preset.binding");
   }
   ```
   `key` 就是 agent 的 scope（`bind()` 里 `const key = scopeOf(ctx)`，`:670-672`；调用方是 `mount(agent.ctx, id)`，`:750-775`）。
   `bindScopeParent` 语义见 `dsh-scope/lib/index.js:256-262`（重复绑定抛错，返回 `{ rebind }`）；`scopeChainOf` 因此得到 `[agent, generation]`。

2. `view(agent)` 的 `inherited` = 全局层 + **所有祖先层**，`restrictableNames` 就取自它：

   `dsh-tools/lib/index.js:480-496`
   ```js
   const inherited = new Map(this.layers.global.tools.entries());
   for (const layer of layers) { if (layer === own) continue; for (const [name, registration] of layer.tools.entries()) inherited.set(name, registration); }
   for (const [name, registration] of inherited) { knownNames.add(name); restrictableNames.add(name); if (layers.every((layer) => layer.admits(name))) { ... } }
   ```

3. `restrict()` 的合法名字集就是这个 `restrictableNames`（`:464-466`），且 `admits` 在 `layers.every(...)` 里对**每一层**（含 own 与 generation）检查——own 自己那条 filter 同样参与判定。所以对 preset 工具点名 restrict **既合法又生效**。

4. JSDoc 原文（`:446-449`）：「Restrictions intersect; **scoped registrations remain visible**」；`:469-473`：「Restrictions across the scope chain intersect over inherited global **and ancestor** tools; the viewing scope's own registrations remain exempt」。README.zh.md:88 也写「对单个 agent **继承的全局工具**应用允许/拒绝掩码；掩码取交集，**作用域注册保持可见**」——这里的「作用域注册」指的是**查看者自己那层**。

### 8.2 正确表述

> `restrict` 掩掉的是「全局层 + agent 的全部祖先层（含 preset generation 层）里的工具」；只有**注册在 agent 自己 scope 上**的工具（`setup(ctx)` 里 `ctx.tools.register` 的那些，例如 `structured_output`）免疫，且这些名字**不能**出现在 allow/deny 里（`restrictableNames` 不含它们，会抛 `names unknown global tool`）。

### 8.3 对 D13「混合方案」的实际影响

- **好消息**：混合方案的掩码层可以连 preset 工具一起管，不存在「两套机制打架」。
- **坏消息（必须处理）**：
  1. 若用 `allow` 做白名单，**allow 集合必须包含 preset 的工具名**（否则 preset 装上的工具会被一起掩掉，等于 preset 白装）。而 allow 集合写死时，preset 后续增删工具就会失效（新工具不在集合里 → 被掩）。
  2. `restrict({allow})` 的**校验在调用时**做：名字必须在 `restrictableNames` 里。所以**必须先挂载 preset、再 `restrict`**；顺序反了会抛 `restrict() names unknown global tool ...`。
  3. 只用 `deny` 是「失败开放」：会话中途新注册的 host 工具（例如新连上的 MCP server）默认可见；用 `allow` 是「失败关闭」：新工具默认不可见。文档 D13 备注说「guard 覆盖会话中途新注册的工具」——`allow` 掩码本身就能覆盖，guard 只在需要给出人话解释时才有必要。
  4. 反过来，`restrict` 不会自动清掉 preset 插件写的 prompt section（第 2.2 节），如果某个 preset 插件的 section 没做可见性收口，掩掉工具后 prompt 里仍可能残留它的说明文字。

---

## 9. 关键 API 速查（全部为已核实签名）

```js
// @deepseek-ai/dsh-tools (ToolsService, service name "tools")
register(definition, options?: { when?: (ctx: {agent, modelSelection, signal}) => boolean | Promise<boolean> }): Disposer
restrict(filter: { allow?: string[]; deny?: string[] }): Disposer          // 必须 agent.ctx
guard(guard: (exec) => string | undefined): Disposer                       // 不要求 scoped ctx
view(scope?: object): { visible: Map<name, Def>, registrations: Map<name, {definition, when?}>, knownNames: Set<string>, restrictableNames: Set<string> }
get(name: string, scope?: object, toolSet?: ResolvedToolSet): Def | undefined
executable(name: string, scope?: object, toolSet?: ResolvedToolSet): Def | undefined
definitions(scope?: object, toolSet?: ResolvedToolSet): Def[]
schemas(scope?: object, toolSet?: ResolvedToolSet): ToolSchema[]           // {name, description, parameters, deferLoading?}
async resolve(context: { agent, modelSelection, signal }): ResolvedToolSet // { dispose(), view(scope) }
setExecutor(executor): Disposer
async execute(input): Promise<...>
checkGuards(exec): string | undefined

// 事件
"agent/created"   serial, payload { agent, source, signal? }        // dsh-agent/lib/index.js:703-719
"agent/pre-step"  waterfall, payload { messages, turn, step, signal, modelSelection } // dsh-agent-loop/lib/index.js:685-697
"agent/disposed"  emit, payload { agent }                            // dsh-agent/lib/index.js:678-692
"tools/change"    emit, 无 payload                                   // dsh-tools/lib/index.js:410-412

// preset registry
async acquireScope(id?: string): { key, [Symbol.asyncDispose] }      // dsh-agent-preset-registry/lib/index.js:787-803
async select(agent, agentPreset): string                             // 仅限首轮前
async mount(ctx, id): { id }                                         // ctx = setup 的 agent ctx
```

---

## 10. 不确定 / 未验证

1. **`ctx.effect` 返回的 disposer 是否严格同步可调**：`dsh-scope` 内部是 `yield () => {...}`，Cordis 的 effect disposer 通常是同步函数或返回 Promise 的函数。「先 dispose 再 restrict」在同一 tick 内连续做，理论上安全（undo 是同步的），但**没有实测**；保守写法是 `await` 一下（`await oldDispose?.()`）。
2. **UI 侧是否有别的目录能力**：只解出了 `dsh-tools`/`dsh-agent*` 等后端包；`dsh-client-ui-*` 里是否另有一套「工具列表」投影（例如设置页展示工具）没有全量核查——本次 grep 未发现 `tools.list` 或 remote 暴露，但不能 100% 排除某个 UI 包自己维护了一份。
3. **`dsh-tool-cordis/lib/types/api-catalog.js`** 是一个 5000+ 行的 Cordis API 目录（供 `cordis` 工具给模型查框架 API 用），它**记录**了 `tools/change` 等 API 文档（`:5202`），但不是工具注册表的运行时目录。未深入阅读，仅作旁证。
4. **`agent/pre-step` 的 dispatch 作用域**：`this.dispatch = agentEvents(loopCtx, this)`（`dsh-agent-loop/lib/index.js:536-553`），`agentEvents` 的过滤规则未细读；从 `agent/pre-step` 能读到 `agent` 字段看，它对当前 agent 的监听者可见，但「谁能收到别的 agent 的 pre-step」没有验证。
5. **token 量级**是按 `estimateToolsTokens` 的公式 + 抽样长度推的**估算**，不是实测请求体；真实值取决于 `JSON.stringify` 的字段顺序与 schema 体积。要精确值，可在会话里抓一次 `request/header` 事件（它带完整 `header.tools`）。
