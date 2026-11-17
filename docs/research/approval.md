# DSH「用户批准 / 权限 / 工具放行」机制调研

> 只读调研。源码来自 `app.asar` 解包：`D:\PersonalFiles\PersonalProjects\dsh-toolset\tmp\src\dsh\node_modules\@deepseek-ai\<pkg>\lib\*.js`（bundle 后带 JSDoc 的可读 JS，非混淆）。
> 下文路径统一省略前缀 `tmp/src/dsh/node_modules/@deepseek-ai/`，写成 `dsh-xxx/lib/index.js:LINE`。
> 所有引用均来自实际读到的代码；未读到的东西在文中标为「不确定」。

---

## 0. 结论摘要（先看这里）

| 问题 | 结论 |
|---|---|
| 有没有「一次性用户批准」的服务？ | 有：`ctx.approval.request()`（`dsh-user-approval`），词汇表里只有 `allowed-once / rejected / cancelled / unavailable`，**没有 allow-always、没有授权存储** |
| 批准能直接放行一次工具调用吗？ | 能，但**必须让该工具先进入工具集**：`tools/pre-execute` 监听器返回 `{kind:"ask", reason, displayReason}`，管线会去问用户，同意后同一调用继续执行 |
| 现有权限体系能控制「工具能不能被调用」吗？ | 不能。「不可见」由 `ctx.tools.restrict()` / 注册组合决定，和 sandbox/approval 策略是两套正交机制 |
| 隐藏的工具能临时露出来吗？ | 能。每一步都会 `tools.resolve()` 重新解析工具集；工具集变化会自动生成 `request/header(change)` + `developer/message{tool-addition|tool-removal}`，LLM 适配层给后加的工具打 `defer_loading` |
| 有没有「工具级 allowlist 持久化」？ | **没有**。只有 `ToolRestriction{allow,deny}`（内存层、随 fiber 销毁）与 subagent 描述符里的 `toolFilter` 字段 |
| 最推荐做法 | **(b)+(d) 组合**：元工具发起一次性批准 → 写入会话内的「一次性授权」状态 → 解除该工具 restrict 一个 step → 前置 `tools/pre-execute` 守卫校验并消费授权 → 调用结束（或轮次结束）立刻重新 restrict |

---

## 1. `dsh-user-approval`：完整的批准机制

### 1.1 服务形态与调用方

服务名 `approval`（`super(ctx, "approval")`），通过 `ctx.get("approval")` / `ctx.approval` 取得：

```js
// dsh-user-approval/lib/index.js:91-98
var ApprovalService = class extends Service {
	static inject = ["sessionProjections"];
	static Config = z.object({ policy: z.union(["ask", "never"]).default("ask") });
	constructor(ctx, config) {
		super(ctx, "approval");
```

真正调用它的生产代码只有两处（已确认）：

1. **工具执行管线**（通用入口）：`dsh-tools/lib/pipeline.js:608-660` 的 `serviceAsk()`，把 `tools/pre-execute` 返回的 `ask` 决议翻译成一次批准请求。
2. **单个工具的「升级」流程**：`dsh-tool-bash` 的 `sandbox_permissions` → `approveEscalation()`（`dsh-sandbox/lib/index.js:137-158`），以及 `dsh-plugin-manager` 的同类调用（`dsh-plugin-manager/lib/types/tools.js:95`）。

调用方自己不需要知道 UI 在哪：**应答者（answerer）是 `approval/request` waterfall 的监听器**，谁先返回词表内的字符串，谁就替这个 agent 做了决定；没有监听器 → 默认返回 `"unavailable"`（fail closed）。

```js
// dsh-user-approval/lib/index.js:197-214（decide）
const answer = Promise.resolve().then(() => this.ctx.waterfall(scopeTarget(req.agent, req.agent), "approval/request", req, () => Promise.resolve("unavailable"))).then(
	outcome => OUTCOMES.includes(outcome) ? outcome : "unavailable",
	() => "unavailable");
```

`README.zh.md:32` 明确：应答者是 waterfall 监听器，返回一个结果即为所负责 agent 作答，否则 `next()`；「每项部署应组合一个最终应答者——同级监听器的顺序不是策略优先级机制」。

### 1.2 请求数据结构

```js
// dsh-user-approval/lib/index.js:153-169（request）
async request(req) {
	const session = req.agent.session;
	if (!this.approvalStateOf(session).turnOpen) throw new Error("approval.request() outside an open turn: ...");
	const id = ApprovalRequestId(randomUUID());
	session.append("approval/asked", { id, toolName: req.toolName, ...callId, ...reason });
	const outcome = await this.decide(req, session);
	session.append("approval/decided", { id, outcome });
	return outcome;
}
```

字段（`lib/types/index.js:132` 的 JSDoc：「the pending decision (agent, tool identity, reason, signal)」；下表的类型据实现与 JSDoc 整理，`lib/types` 里没有导出成名的 `ApprovalRequest` 接口，只有 `ApprovalRequestId`）：

```ts
req = {
  agent: Agent;          // 必填：用来定位 session、审计、路由 UI
  toolName: string;      // 必填：只有工具名，没有参数
  callId?: string;       // 可选：ACP 机器通道要求；不带则委派给不要求 id 的应答者
  reason?: string;       // 英文（审计用），会写进 approval/asked
  displayReason?: string;// 可选：本地化后的展示文案（不进审计事件）
  signal?: AbortSignal;  // 可选：abort → "cancelled"
}
```

**硬约束**：必须在「已开启的轮次」内调用，否则直接抛错（`lib/index.js:155`）。原文：

> `approval.request() outside an open turn: the approval/asked + approval/decided audit pair must be turn-enclosed (a bare event between turns is crash-tail garbage on reload). Ask from inside the turn that needs the decision.`

`turnOpen` 由投影状态维护（`turn/start` → true、`turn/end` → false，见 `lib/types/index.js:39-42`）。也就是说：**不能做「跨轮次挂起的批准」**；模型必须在需要的那一刻、在同一个 turn 里发起。

### 1.3 结果如何回到调用方

`request()` 直接 `await` 到闭集结果，返回值是字符串（`lib/index.js:30-35`）：

```js
const OUTCOMES = ["allowed-once", "rejected", "cancelled", "unavailable"];
```

- `allowed-once`：唯一表示「同意」的值；
- `rejected`：用户点了拒绝；
- `cancelled`：signal 被 abort（工具调用被取消）；
- `unavailable`：没有应答者 / 应答者抛错 / 返回了词表外的值（全部归一到这一格，fail closed）。

`decide()` 里还有一条**不可绕过**的短路：`effectivePolicy(session) === "never"` 时直接返回 `"rejected"`，位置在 waterfall 之前（`lib/index.js:191-192`），注释解释了原因（`lib/types/index.js:186-190`）：即使是 `prepend: true` 的监听器也无法改变「never 一定拒绝」的承诺。

### 1.4 UI 呈现形式

浏览器端在 `dsh-client-ui-approval/lib/client.js`：

```js
// lib/client.js:475-477
ctx.remote.$on("approval/request", function(request, next) {
	return answerApproval(ctx, this, request, next, registerPendingInteraction);
});
```

```js
// lib/client.js:173-184（ApprovalPanel）
const reason = approval.displayReason === void 0 ? approval.reason : props.resolveReason(approval.displayReason, ...);
props.renderFactorySlot("conversation.approval.card", {
	requestKey, title: reason ?? props.t("escalation", { toolName: approval.toolName }), ...callId,
	canAnswer: () => approval.answerable,
	onAllow: () => approval.answer("allowed-once"),
	onReject: () => approval.answer("rejected")
});
```

- 卡片只有「允许一次 / 拒绝」两个动作；卡片 props 类型里留着 `onAlways`（`client.js:45`），但**从未传入**——即 UI 层也没有「永久允许」。
- 同时会注册 `conversation.composer` takeover（`client.js:468-474`）与 pending interaction（`client.js:458`），Enter=允许、Esc=拒绝（`client.js:437-457`）。
- 标题默认是 `t("escalation", {toolName})`；只有 `reason`／`displayReason` 能携带更多上下文（**没有参数**，见 1.6）。

Host 侧把 `approval/request` 转发给客户端的是 `dsh-api-remotes`：

```js
// dsh-api-remotes/lib/index.js:26-29
{ event: "approval/request", mode: "waterfall" },
```

```js
// dsh-api-remotes/lib/index.js:241-258（forwardWaterfall）
function forwardWaterfall(queue, event, request, context, next) {
	const settled = Promise.withResolvers();
	const dispatch = { event, request, context, resolve: (outcome) => {
		if (outcome.kind === "result") { settled.resolve(outcome.value); return; }
		Promise.resolve().then(next).then(settled.resolve, settled.reject);
	}, reject: settled.reject };
	if (!queue.push(dispatch)) Promise.resolve().then(next).then(settled.resolve, settled.reject);
	return settled.promise;
}
```

客户端「无法作答」时走 `next()`（`PendingApproval.delegate()` 用 `#delegated` Symbol 拒绝，让上层继续 waterfall），最终落到默认的 `"unavailable"`。

### 1.5 粒度与持久化

- **只有一次**。README.zh.md:165 逐字：「**仅存在一次性授权**：结果词汇包含 `allowed-once`，但不含 `allow-always`、已记住的规则、撤销或授权存储；会话策略只有 `ask`／`never`」。
- **会话级策略**是唯一被持久化的东西，且是「问不问」，不是「准不准」：

```js
// dsh-user-approval/lib/index.js:82（setApprovalPolicy）
session.append("approval/policy", { policy });
```

投影 `approvalState = { policy: "ask"|"never"|null, turnOpen: boolean }`（`stateVersion: 1`）；`effectivePolicy = overrideOf(session) ?? config.policy ?? "ask"`（`lib/index.js:170-172` 附近）。

- **待处理审批只在进程内**：README.zh.md:168「待处理审批仅在进程内有效：检查点恢复策略和轮次状态，不恢复待处理应答的 Promise 或一次性授权」。
- 审计是事件对：`approval/asked` + `approval/decided`（同一 turn 内成对，跨轮次会产生 reload 时的 crash-tail）。

`setPolicy(agent, policy)` 会顺手 `agent.inject(...)` 一条 user 消息告诉模型策略变了（`lib/index.js:123-135`），并把当前策略写进运行时上下文 `approval:policy`（`ASK_SENTENCE` / `NEVER_SENTENCE`）。

### 1.6 已知限制（README.zh.md:164-168，逐字要点）

1. 请求只在**尚未结束的轮次**内有效；
2. 仅一次性授权，无记住的规则、无撤销、无授权存储；
3. **请求不携带工具参数**：应答者只看到工具名、原因、可选调用 id；
4. **没有内置应答者**：无头部署返回 `unavailable` 并 fail closed，服务自身绝不会提示人类；
5. 待处理审批仅在进程内有效。

### 1.7 最小调用示例（插件内）

```js
// 在一个工具 execute() 里，或任意处于开启轮次内的插件代码里
const outcome = await ctx.approval.request({
  agent: exec.agent,            // 必填，决定审计写入哪个 session、路由到哪个 UI
  toolName: "some_tool",
  callId: exec.callId,          // 可选，但 ACP 通道需要
  reason: "the model asked to run some_tool",           // 英文/审计
  displayReason: "模型想运行 some_tool（一次）",         // 可选，本地化展示
  signal: exec.signal,
});
if (outcome !== "allowed-once") return { ok: false, outcome };
```

如果要**自己当应答者**（例如做一个无 UI 的策略层）：

```js
ctx.on("approval/request", async (request, next) => {
  if (request.toolName !== "some_tool") return next();
  return "allowed-once"; // 或 "rejected"
}, { prepend: true });
```

注意顺序语义：`prepend` 只能抢在别的监听器之前，抢不过 `policy === "never"`（服务内部短路）。

---

## 2. `dsh-tools/lib/pipeline.js`：执行管线的顺序与每步能力

### 2.1 真实顺序

`prepare()`（`dsh-tools/lib/pipeline.js:375-435`）实际做的事：

```
createExecution（快照/冻结 arguments）
  → callerCancelled 检查
  → tools/pre-execute waterfall        ← 策略：allow / deny / ask / cancel
  → 若 ask：serviceAsk → ctx.approval.request(...)   ← 用户批准
  → cancel? → ABORTED_BEFORE_DISPATCH
  → checkGuards(exec)                  ← guard：同步、单调、不可翻案
  → dispatch（tools/execute around-dispatch → tool.execute）
  → complete（tools/post-execute → content projector → finalize）
  → notifyResult（tools/result 事件）
```

关键三行（同一函数内，顺序即语义）：

```js
// dsh-tools/lib/pipeline.js:386
const gate = await this.ctx.waterfall(carrier, "tools/pre-execute", exec, () => Promise.resolve({ kind: "allow" }));

// dsh-tools/lib/pipeline.js:387-390
const askResolution = gate.kind === "ask" ? await this.serviceAsk(exec, gate) : { decision: gate, approvalCancelled: false };

// dsh-tools/lib/pipeline.js:402
const denialReason = decision.kind === "allow" ? this.tools.checkGuards(exec) : decision.reason;
```

### 2.2 每一步能做什么

| 阶段 | 位置 | 能力 | 限制 |
|---|---|---|---|
| `createExecution` | `pipeline.js:293-350` | 冻结参数（`snapshotJsonValue` + `deepFreeze`）、生成执行 token、记录 `parent`/`toolSet`/`schema` | 参数必须可无损 JSON 序列化，否则 `TypeError("tool execution arguments must be losslessly JSON-serializable")`（:328） |
| `tools/pre-execute` | `pipeline.js:386` | **异步**，可返回 `{kind:"allow"}` / `{kind:"deny", reason, info?}` / `{kind:"ask", reason?, displayReason?}` / `{kind:"cancel"}`；可 `await` 任意东西（LLM、用户） | 有意**不允许改写 `exec.arguments`**（`dsh-tools/README.zh.md` 有明确说明） |
| approval（仅当 ask） | `pipeline.js:608-660` | 走 `ctx.approval.request()`，把四种结果映射成 allow/deny（deny 文案区分「用户拒绝」「被取消」「无批准通道」） | 需要 `exec.agent`；缺 approval 服务或 agent 时直接 deny（fail closed） |
| `checkGuards` | `pipeline.js:657-662`；`dsh-tools/lib/index.js:649-651` | 同步守卫链：`[guards.global, ...guards.chainLayers(exec.agent)]`，返回字符串即拒绝原因 | **同步**，不能询问用户；一旦某个 guard 返回原因就是终局，后续 listener 无法翻案 |
| `tools/execute` | `pipeline.js:488-511` | around-dispatch 瀑布，可包装执行 | 最终仍调 `dispatchToolBody` → `definition.execute(args, exec)` |
| `dispatchToolBody` | `pipeline.js:455-480` | `resolveExecution(name, scope, nested, toolSet)` 找不到就抛 `ToolNotFoundError`；否则 `await tool.execute(exec.arguments, exec)` | 解析器可注入（见 2.4） |
| `tools/post-execute` / `tools/result` | `pipeline.js:521-542`、`:578-596` | 结果改写、通知、UI 呈现 | — |

### 2.3 approval 与 guard 的先后关系 —— 对「先批准再放行」意味着什么

**顺序是 approval → guard**（`pipeline.js:387` 在前，`:402` 在后）。三个直接后果：

1. **「用户批准」不等于「一定执行」**：guard 仍可在批准之后拒绝。设计上的含义是 guard 表达的是「无论谁批准都不行」的硬约束（例如 `dsh-subagent` 里「结构化输出已记录，本轮结束」那条 guard，`dsh-subagent/lib/index.js:945`）。
2. **guard 不能用来提问**：它同步、无 signal、不可 await，所以「申请一次权限」只能写在 `tools/pre-execute` 的 `ask` 上，或写在工具自己的 `execute` 里（像 bash 的 `sandbox_permissions` 那样）。
3. **批准是被「管线」而不是被「工具」消费的**：`ask` 一旦被批准，管线把决策改写成 `{kind:"allow"}` 然后继续；工具自己完全不知道发生过批准（除非它自己调了 `ctx.approval`）。这带来一个陷阱：**如果工具自身还有一层批准，就会出现两次弹窗**（见 §5.a 的缓解方案）。

还有一个细节在 `dsh-experimental-auto-review` 里被显式处理，值得抄：

```js
// dsh-experimental-auto-review/lib/index.js:590-593
const downstream = await next();
if (isAborted(lifecycle.signal)) return { kind: "cancel" };
if (decision.decision === "allow" || downstream.kind !== "allow") return downstream;
return askUser(exec, decision.reason);
```

即：**先让下游策略跑（`next()`），只有下游允许时才把决定升级成 `ask`**；下游已经 deny 就不要再多问用户一次。这是「策略叠加」的正确写法。

### 2.4 管线是插件可复用的（重要扩展缝）

```js
// dsh-tools/lib/pipeline.js:251-266
var ToolExecutionPipeline = class {
	constructor(ctx, source = {}) { ... }
	get(name, scope, toolSet) {
		return this.source.get === void 0 ? this.tools.executable(name, scope, toolSet) : this.source.get(name, scope, toolSet);
	}
	resolveExecution(name, scope, nested, toolSet) {
		const tool = this.get(name, scope, toolSet);
		return tool !== void 0 && this.source.reject?.(name, nested) === void 0 ? tool : void 0;
	}
```

包导出表里 `./pipeline` 是公开子路径（`dsh-tools/package.json` 的 `exports`），`executeToolBatch(input, pipeline, maxParallel)` 也是导出的。**这意味着插件可以构造自己的 pipeline，用自定义 `get` 覆盖「谁能被解析」**——这是 (a) 路线（元工具代为执行）的技术基础。

`dsh-tool-executor-ptc` 就是这么干的（给 `run_code` 自己留了个 transport）：

```js
// dsh-tool-executor-ptc/lib/index.js:1733-1734
this.pipeline = new ToolExecutionPipeline(ctx, {
	get: (name, scope, toolSet) => name === RUN_CODE_NAME ? this.requirePtcTransport() : tools.executable(name, scope, toolSet),
```

---

## 3. 现有「权限」体系：三套都不是「工具级白名单」

### 3.1 `dsh-authorization`：凭据获取，不是工具放行

```js
// dsh-authorization/lib/index.js:60
static inject = ["credentials"];
```

API：`registerFlow(flow)`（:75）、`list()`（:90）、`describe(key)`（:98）、`cancel(key)`（:117）、`begin(request)`（:138，错误码 NO_FLOW / UNKNOWN_METHOD / ALREADY_IN_FLIGHT）、`settle(key, settlement)`（:175）、`attempt(flow, method, signal, interaction)`（:196，要求本次尝试内 commit 凭据记录，否则 NOT_COMMITTED）。

**结论**：它管的是「拿 API key / 走 OAuth」，`AuthorizationDeclinedError` 也是凭据流程的拒绝。与「某个工具能不能被调用」无关。

### 3.2 `dsh-permission-presets`：把（沙箱模式 + 批准策略）打包成「预设」

```js
// dsh-permission-presets/lib/index.js:59-62
const AUTO_PRESET_SPEC = { sandbox: "danger-full-access", approval: "ask" };
// :145-158 默认预设
"workspace-write": { sandbox: "workspace-write", approval: "ask", ... }
"danger-full-access": { sandbox: "danger-full-access", approval: "never", ... }
```

```js
// dsh-permission-presets/lib/index.js:212-236（permission 命令）
this.apply(agent.session, name, (policy) => { this.ctx.approval.setPolicy(agent, policy); });
```

写会话事件 `permission/preset`、`sandbox/mode`、`approval/policy`；投影 `{ key:"permissions", stateVersion:2 }`，状态 `{preset, sandbox, approval, seeded}`。服务注入 `["shell","approval","sessions","agents","sessionProjections"]`，并要求执行器带 `sandboxMode`（否则在加载期抛「the mounted bash executor does not confine (no sandboxMode)」）。

**结论**：它控制的是「**动作能不能成功**」（文件系统/命令执行的沙箱边界）与「**要不要问用户**」，不是「工具可不可见/可不可调用」。

### 3.3 `dsh-sandbox-policy`：文件沙箱的「当前强度」

`SANDBOX_MODES`、`setSandboxMode(session, mode)`（:40，写 `sandbox/mode` 事件）、投影 key `sandboxMode`、`SandboxPolicyService.resolve({session})` 给出当前模式。模型侧只会看到一句策略说明，例如：

> `Current DSH file policy: read-only. Any available operation enforced by the DSH file sandbox cannot modify files in the standing mode. Do not refuse a required modification from this policy alone: try an available tool normally and follow any denial and escalation guidance it returns.`（`dsh-sandbox-policy/lib/index.js:87`）

注释里点明优先级：「capability call, weakest-precedence beneath an escalation grant」（:17）——即**一次性的升级授权（escalation grant）优先于常驻模式**，只是这个 grant 只对「这次调用」有效。

### 3.4 与「工具可见性」是不是两套？

**是两套，而且是正交的：**

| 维度 | 机制 | 实现位置 | 效果 |
|---|---|---|---|
| 工具**是否存在/可见** | 注册（`tools.register(definition, {when})`）+ `tools.restrict({allow,deny})` + `tools.resolve()` 产生的 toolSet | `dsh-tools/lib/index.js:433-445`、`:453-468`、`:542-572` | 影响系统提示里的 schema、`tools.executable` 的解析、PTC 的 SDK 声明 |
| 工具**能否执行成功** | sandbox 模式（文件写、进程） | `dsh-sandbox*` | 调用能进来，但落盘/执行被拦 |
| 工具**是否要问用户** | approval 策略 + `ask` 决议 + guard | `dsh-user-approval`、`pipeline.js` | 影响流程，不影响 schema |

`restrict()` 之所以同时影响「看得见」和「调得到」，是因为它作用的正是 toolSet——schema 与解析共用同一个 `toolSet.view(scope)`：

```js
// dsh-tools/lib/index.js:519-534
get(name, scope, toolSet) {
	return toolSet === void 0 ? this.view(scope).visible.get(name) : toolSet.view(scope).get(name);
}
executable(name, scope, toolSet) {
	if (toolSet !== void 0) return toolSet.view(scope).get(name);
	const view = this.view(scope);
	return view.registrations.get(name)?.when === void 0 ? view.visible.get(name) : void 0;
}
```

`restrict()` 的实现要点：

```js
// dsh-tools/lib/index.js:453-468
restrict(filter) {
	const scope = scopeOf(this.ctx);
	if (scope === void 0) throw new Error("tools.restrict() requires a scoped context (agent.ctx): a context-global restriction would mask every agent — deny the tool for the intended agent instead");
	...
	if ([...allow ?? [], ...deny ?? []].includes("run_code")) throw new Error(`tools.restrict() cannot name reserved PTC mode presentation transport ...`);
	const known = this.view(scope).restrictableNames;
	const unknown = [...allow ?? [], ...deny ?? []].filter((name) => !known.has(name));
	if (unknown.length > 0) throw new Error(`tools.restrict() names unknown global tool ...`);
	return this.layers.effect(this.ctx, (layer) => layer.restrictions.append(compiled), { label: "tools.restrict()" });
}
```

- 只能限制**全局注册的工具**（`restrictableNames` 来自 inherited 全局层），scope 自己注册的工具天然豁免（`view()` 的 `own` 分支，:497-501）；
- 返回 **disposer**，可随时解除 → 这就是「临时放行」的开关；
- 多层限制取交集（`layers.every(layer => layer.admits(name))`，:492）。

### 3.5 工具级白名单现状

- 类型：`ToolRestriction { allow?: string[]; deny?: string[] }`。
- 使用点：`ctx.tools.restrict(...)`（运行时、作用域层、可销毁）；`dsh-subagent` 的子代理组合 `composition.toolFilter`（`dsh-subagent/lib/index.js:396`），可持久化在 subagent 描述符里（`dsh-subagent/lib/types/descriptor.js:44/74-91`）。
- **没有**任何「按会话记住某些工具已被允许」的存储。

---

## 4. `ask_user_question` 能否当「申请授权」的 UI 载体

### 4.1 能被插件/工具内部调用

能。`dsh-tool-ask-user` 的 `execute` 本身调的就是服务 seam，而不是 HTTP/UI：

```js
// dsh-tool-ask-user/lib/index.js:304-320（legacy execute）
return {
	answers: (await ctx.userQuestions.ask({
		questions: ...,
		...exec.agent ? { agent: exec.agent } : {},
		signal: exec.signal
	})).answers.map((a) => ({ id: a.id, selected: [...a.selected], ...a.custom }))
};
```

所以插件里直接 `await ctx.userQuestions.ask({ questions, agent, signal })` 即可，**不必经过 `ask_user_question` 这个工具**（也就不需要它出现在工具集里）。

服务签名与校验（`dsh-user-questions/lib/index.js:676-719`）：

```
ask(request: { questions: Question[]; agent?: Agent; signal?: AbortSignal })
askTimed(request, callId, timeoutMs)     // :621
answer(agent, callId, answer)            // :560，@Remote，客户端回填
```

### 4.2 返回值形状

```ts
// dsh-tool-ask-user 的输出 schema（lib/index.js:274-298）
{ answers: Array<{ id: string; selected: string[]; custom?: string }> }
// timed 模式超时：
{ pending: true; callId: string; message: string }
```

- 空 `selected` 且无 `custom` = 用户跳过；
- 错误码：`ASK_ABORTED / CALLER_NOT_LIVE / DELEGATED_CALLER / NO_PROVIDER / BAD_INTENT / EMPTY_QUESTIONS / ASK_TIMED_OUT / BAD_ANSWER`。
- 子代理里没有人类应答者 → `DELEGATED_CALLER`（`assertLiveRoot(agent)`）。

### 4.3 已经有一个「批准」形态的 intent（但没人用）

```ts
// dsh-user-questions/lib/typert.host.js:276 附近的类型声明
type AskUserQuestionIntent =
  | { kind: 'plan-review'; approve: string; callId?: ToolCallId }
  | { kind: 'approval'; approve: string; reject: string; always?: string;
      subject?: { name: string; icon?: string };
      display?: { question: { en: string; [locale: string]: string }; detail?: {...}; approve?: {...} } };
```

校验规则（`dsh-user-questions/lib/index.js:682-706`）：`kind === "approval"` 时

```js
const labels = intent.kind === "approval" ? [intent.approve, intent.reject, ...(intent.always === void 0 ? [] : [intent.always])] : [intent.approve];
```

要求：每个 label 出现在 `options` 里且必须有 `detail`；只有 1 个问题；`multiSelect !== true`；不能带 `wait`；labels 互不相同；`options.length === labels.length`。

**也就是说，UI 层的「同意 / 拒绝 / 永久允许」三按钮载体是存在的（`always` 字段就是证据），但全树 grep 没有任何生产代码构造 `kind: "approval"`**——已解出的包里没有使用者（可能在未解出的 `dsh-client-ui-action-cards` 之类的呈现包里，属于「不确定」）。目前唯一在用的 `intent` 是 `plan-review`（`dsh-client-ui-user-questions/lib/client.js:46` 只特殊处理 plan-review）。

### 4.4 作为「申请授权」载体的评价

**可行，且比 `ctx.approval` 更好用的地方**：可以放多个选项按钮、可以带 `detail` 长文案、可以把工具名+一句话用途+参数摘要都塞进去。

**不如 `ctx.approval` 的地方**：

1. 没有审计事件对（`approval/asked`/`approval/decided`），会话回放看不到「问过、答了什么」；
2. 不认 `approval/policy`（即使用户把策略设成 `never`，`userQuestions.ask` 依然会弹）；
3. 需要自己实现「无应答者时 fail closed」（`NO_PROVIDER` 会抛错，要 catch）；
4. 子代理里直接不可用（`DELEGATED_CALLER`）。

结论：**做产品化 UI 用 `userQuestions.ask` + `intent.kind="approval"`；做「与既有批准语义一致的一次性放行」用 `ctx.approval.request`**。两者可以叠加（先用 approval 记录审计，再用 questions 展示细节），但同一件事问两次是反模式。

---

## 5. 「请求一次工具权限」的四条路径

先明确一个前提事实（决定所有方案的可行性）：**模型只能调用它在这一步 schema 里见过的工具**，因为 `ToolExecutionPipeline` 用 `toolSet` 解析，而 `toolSet` 由 `tools.resolve()` 在每一步 `preStep` 现算：

```js
// dsh-agent-loop/lib/index.js:673
const toolSet = await this.loopCtx.tools.resolve({ agent: this, modelSelection: selection, signal });
// :961-971（step 执行）
this.loopCtx.tools.execute({ calls, signal, agent: this, log: { turn, step }, maxParallelToolCalls, toolSet: decision.toolSet });
```

而 `resolve()` 只把 `view.visible` 里通过 `when` 的工具放进集合（`dsh-tools/lib/index.js:542-558`），`visible` 又被 `restrict` 过滤（:485-496）。

第二个前提事实（决定 (b) 的体验）：工具集变化是**一等公民**。`buildRequest()` 会比较 `requestHeader` 并追加 developer 消息：

```js
// dsh-agent-loop/lib/index.js:1045-1063
const previousNames = new Set(baseline.tools?.map((tool) => tool.name));
const currentNames = new Set(tools.map((tool) => tool.name));
const additions = tools.filter((tool) => !previousNames.has(tool.name)).map((tool) => ({ type: "tool-addition", toolName: tool.name }));
const removals = (baseline.tools ?? []).filter((tool) => !currentNames.has(tool.name)).map((tool) => ({ type: "tool-removal", toolName: tool.name }));
if (additions.length > 0 || removals.length > 0) session.append("developer/message", {
	...position, message: createDeveloperMessage({ source: { kind: "tool-registry" }, content: [...additions, ...removals] }),
	...additions.length > 0 ? { headerSeq } : {}
}, { surfaceOp: "append" });
```

后加入的工具在投影时会被打上 `deferLoading: true`（`dsh-llm/lib/index.js:760-764`），DeepSeek 适配器把它翻成 `defer_loading: true`（`dsh-llm-deepseek/lib/index.js:1742`）。block 类型定义里 `tool-addition.toolName` 只有名字、`tool?: never`（`dsh-session/lib/types/surface.js` 附近的声明），要求「必须在该 headerSeq 里有完整定义」（`dsh-session/lib/index.js:342-346`）。

> 不确定：`defer_loading` 在供应商侧的确切语义（是否等于「只给名字、按需加载 schema」）未在本仓库验证；按 DeepSeek/Anthropic 的 tool-search 协议推断是「延迟加载」，但没能读到 provider 文档级证据，属于需实测项。

### 5.a 元工具 `request_tool(name, args)`：批准后由元工具代为执行

**可行性：可行（中等工程量）**。依赖：

1. 能枚举/解析「被 restrict 掉的目标工具」。`restrict` 是**作用域层**限制（`ScopedLayers`，`dsh-scope/lib/index.js:162-169` 的 `chainLayers(scope)`；`undefined` scope 只有 global 层），所以：

```js
// 全局视图：不受任何 agent 作用域限制影响
const all = ctx.tools.view(undefined).visible;      // Map<name, definition>
const def = all.get("target_tool");                  // definition.parameters 就是 inputSchema
```

2. 能构造一次「守卫内转发」。两种写法：
   - **推荐**：`new ToolExecutionPipeline(ctx, { get: (name) => ctx.tools.view(undefined).visible.get(name) })` + `executeToolBatch({ calls: [{ id: callId, name, arguments: JSON.stringify(args) }], agent: exec.agent, signal: exec.signal }, pipeline, 1)`（注意 `calls[].arguments` 是**原始 JSON 字符串**，`pipeline.js:35-42` 的 `parseArguments` 会 `JSON.parse`）—— 这样 `tools/pre-execute`、approval、guard、`tools/result`、presentation 全都照常；
   - **不推荐**：直接 `def.execute(args, { agent, callId, ... })` —— 绕过整条策略链（含 guard），且 `exec` 形状要自己拼，容易漏 `toolSet`/`parent`/`signal`。

3. **参数校验可以直接复用目标工具的 schema**：`defineTool()` 在 `execute` 包装里做校验（`dsh-tools/lib/index.js:338-342`）：

```js
async execute(args, exec) {
	const violations = validate(args);
	if (violations.length > 0) throw new ToolArgsError(violations);
	return userExecute(args, exec);
}
```

   所以「转发」天然带校验；元工具也可以先用 `def.parameters`（JSON Schema）+ 导出的 `validateArgs`/`validateJsonSchemaValue` 做一次预校验，给出更友好的错误。

4. **一次性 vs 重复批准**：天然一次性——每次 `request_tool` 都要重新 `approval.request`。如果目标工具自己也返回 `ask`（比如 bash 的 sandbox 升级、或在 auto 预设下的 auto-review），会**二次弹窗**。缓解：
   - 元工具在转发前把 `callId` 记进一个 `WeakSet`/`Map`，并 `prepend` 一个 `tools/pre-execute` 监听器：命中就 `return { kind: "allow" }`（跳过二次询问），转发结束后删除；
   - 或者转发时给 `exec.parent` 赋值（nested 语义，`pipeline.js:303` 的 `reject?.(name, nested)` 与 auto-review 的 `exec.parent === void 0` 判断都依赖它），让策略层知道这是嵌套调用；
   - 注意：**guard 仍然会跑**，这是优点不是缺点。

5. **安全性（模型滥用）**：
   - 用户每次都会看到弹窗 → 滥用成本高，但也可能造成「弹窗疲劳」，建议限流（每轮最多 N 次）并拒绝批量申请；
   - 元工具必须**禁止转发 `run_code`**（`RUN_CODE_NAME` 被处处保留，`register` 与 `restrict` 都显式拒绝它）以及自身（防递归）；
   - 必须禁止通过 `view(undefined)` 拿到「连产品都不该给这个会话」的工具——如果「工作台」是靠**不注册**实现的，`view(undefined)` 也看不到（好事）；如果是靠 `restrict` 实现的，就能看到（符合预期，因为产品本来只想「隐藏」而非「禁止」）；
   - 转发会让客户端把目标调用渲染成嵌套子调用（`exec.parent`），UX 上要接受。

**缺点**：目标工具的呈现（`presentCall`/`presentResult`）、流式、`tools/result` 的归属都变成「元工具的子调用」，与原生调用不完全等价；且模型始终看不到目标工具的 schema，只能照元工具的参数描述猜。

### 5.b 元工具只做批准，然后动态解除 restrict，让目标工具在**下一轮请求**出现

**可行性：可行，且最贴近产品目标（用户体验最好）**。依赖的都是公开 API：

1. `ctx.tools.restrict({ deny: [...] })` 返回 disposer（`dsh-tools/lib/index.js:467`）；
2. `tools/preStep` 每步重新 `resolve()`（`dsh-agent-loop/lib/index.js:673`），`tools.execute` 用的是当步的 `toolSet`；
3. 工具集变化会自动发 `request/header(change)` + `developer/message{tool-addition}`（`agent-loop:1045-1063`），模型下一 step 就能看到它；
4. `tools.register(def, { when })` 提供「step 级激活条件」（`dsh-tools/lib/index.js:433-445`）——如果工具是「自己注册、按条件出现」的类型，可以直接用 `when: () => grantActive` 实现，连 restrict 都不用动。

**粒度**：一次性（只放开一个 step，调用后或轮次结束立刻收回）。

**参数校验**：目标工具自己的 `defineTool` 校验；schema 天然是完整的（模型看到的是真 schema，不是摘要）——这是 (b) 相对 (a) 的最大优势。

**如何避免重复批准**：批准发生在元工具里；解除 restrict 后，目标工具这一次调用**不再经过 approval**（除非它自己还有 ask）。要防止「模型在同一步里连调十次」，需要一个 consume-once 守卫（见 §7 的推荐实现）。

**风险**：
- 放开窗口内，模型可以调用该工具任意多次（同一 step 的并行调用都会过守卫）→ 必须靠「消费一次即收回」的守卫兜底，而不是靠 restrict 的时机；
- 每次工具集变化都会改写 `request/header`，可能影响 prompt cache 命中（`dsh-agent-loop:852` 的 `startsSeries` 逻辑会因 tools 变化而重启 series）——高频授予/收回有成本；
- 如果模型拿到权限后**不调用**，权限会一直挂到轮次结束（需要有 `turn/end` 清理）；
- 会话恢复不会恢复「已批准」状态（审批只在进程内），需要自己把 grant 写成事件才能跨 reload（见 §6）。

### 5.c guard 在拒绝时返回「请申请」文案，由用户手动放行

**可行性：只能作为兜底，单独用不可行**。

原因：guard 只在**调用已经进入管线**时执行（`pipeline.js:402`），而隐藏工具根本走不到这里（`dispatchToolBody` 的 `resolveExecution` 会先失败，甚至在 schema 阶段模型就不知道有这个工具）。所以 guard 文案只能服务两类场景：

1. 工具**可见但需要审批**（例如危险工具默认可见）——此时正确做法不是 guard，而是 `pre-execute` 返回 `ask`；guard 的文案只适合「无论谁批准都不行」；
2. 作为 (b) 的**执行期防线**：授权被消费后，guard 对同一 step 的第二次调用返回「本轮的授权已用完，请重新调用 request_tool」。

另外 guard 是同步的，文案会直接变成工具结果的 `Error: <文案>`（`pipeline.js:407-418`），这正好是「让模型自己改口去申请」的可行反馈通道。

### 5.d 其他现成机制（值得直接复用）

1. **`tools/pre-execute` 返回 `ask`（原生「先批准后执行」）** —— 最正统的做法，`dsh-experimental-auto-review` 就是范本：

```js
// dsh-experimental-auto-review/lib/index.js:536-544
function askUser(exec, reason) {
	const denial = `Auto review denied tool "${exec.name}"`;
	return { kind: "ask", reason: reason === void 0 ? denial : `${denial}: ${reason}`, displayReason: deniedDisplayReason(reason) };
}
```

   管线接住 `ask` → `ctx.approval.request` → 同意后同一调用继续执行。**不需要元工具、不需要转发、不改变工具集**。唯一前提：工具必须已经在工具集里。

2. **`approveEscalation()`（沙箱一次性升级）** —— 现成的「临时提权」范式，包含严格性校验、通道解析、结果映射：

```js
// dsh-sandbox/lib/index.js:137-158
async function approveEscalation(request, approval) {
	const { requestedMode: mode, effectiveMode, justification, subject } = request;
	if (mode === effectiveMode) return effectiveMode;
	if (!(WIDER_MODES[effectiveMode] ?? []).includes(mode)) throw new Error(`sandbox escalation to "${mode}" is not strictly wider than this call's current "${effectiveMode}" mode`);
	if (approval.approver === void 0) throw new Error(`sandbox escalation to "${mode}" requires approval, but no approval service is composed`);
	const outcome = await approval.approver.request({ agent, toolName, callId, reason: `escalate sandbox to ${mode}: ${justification}`, displayReason: ..., signal });
	switch (outcome) {
		case "allowed-once": return mode;
		case "rejected": throw new Error(`the user rejected escalating this ${subject} to "${mode}"; it stays denied, so stop and explain instead of working around it`);
		...
	}
}
```

   注意它的「同一模式直接返回、不弹窗」（`:139`）——这正是「避免重复批准」的既有写法。

3. **`tools.register(def, { when })` 的 step 级条件激活**（`dsh-tools/lib/index.js:433-445`，`resolve()` 在 `:551` 逐个 await `when`）——如果目标工具可以被包装成一个「按授权状态出现」的注册项，这是最干净的「临时可见」实现。

4. **`tool-addition` / `tool-removal` 协议本身**（`agent-loop:1045-1063`）——上面 (b) 复用的就是它；也是「改 tools 数组」的官方方式（不要自己拼 schema 数组）。

5. **PTC `run_code` 的嵌套派发**（`dsh-tool-executor-ptc/lib/index.js:495-511`）：子调用会带 `parent: exec.token`、`toolSet: exec.toolSet`，并写 `tool/ptc-dispatch` 事件。如果产品已经启用 PTC，理论上可以用「授权集合 + PTC 的 SDK 声明」做「看不见但调得到」……但注意 `tools.schemas(exec.agent, exec.toolSet)` 只含被 admit 的工具（`:605`），所以 PTC 也受同一套 toolSet 约束，**不能绕过**。

---

## 6. 有没有「工具级 allowlist 持久化」的现成存储/API？

**没有。** 三个候选都不是：

| 候选 | 实际内容 | 能否存「某会话允许了某工具」 |
|---|---|---|
| `ToolRestriction{allow,deny}` + `ctx.tools.restrict()` | 内存中的作用域层条目，disposer 销毁即消失（`dsh-tools/lib/index.js:453-468`） | 否（不落盘） |
| subagent 描述符 `toolFilter` | 存在 subagent 注册表里，仅用于**创建子代理时**的 restrict（`dsh-subagent/lib/types/descriptor.js:44/74-91`） | 否（不是会话级、不是运行时授予） |
| 插件 `allowBuilds` | 写进插件 profile 的 pnpm 配置（`dsh-plugin-manager/lib/types/build-approval.js:89-97`，`document.setIn(['allowBuilds', name], true)`），是**持久**批准 | 否（是包安装脚本的许可，不是工具） |

**可用的持久化原语（自己造的话）**：

1. **会话事件 + 投影**（正统做法，`dsh-permission-presets` 就是范本）：`ctx.sessionProjections.register({ key, stateVersion, stateSchema, init, apply })`，自己 `session.append("myplugin/tool-grant", { tool, callId, scope })`，在投影里 fold 出「本会话已被授予一次性权限的工具」。好处：随会话持久化、可回放、UI 可读；坏处：要处理 `turn/end` 清理与重复。
2. **`ctx.settings`**（`dsh-settings` 包存在，本次未细读）——适合全局/进程级默认值，不适合「一次性」。
3. **进程内 Map**（最简单）：`WeakMap<session, Set<toolName>>`，轮次结束清空。这与 README 说的「待处理审批仅在进程内有效」一致，但**不能跨 reload 恢复**。

**结论**：要实现「本会话允许一次」的持久语义，必须自己写事件+投影；DSH 没有现成的「工具授权表」。

---

## 7. 推荐方案

### 7.1 推荐：(b) 为主 + (d) 的两个原生点做骨架

**理由**：

1. 用户在批准后看到的是**真实的工具调用**（真 schema、原生呈现、原生结果），符合「临时提权」的产品直觉；
2. 不需要绕过任何策略：`restrict` 解除后，管线、guard、`tools/result` 全部照常，安全性由既有机制兜底；
3. 只依赖公开 API：`ctx.tools.restrict()`（disposer）、`ctx.approval.request()`、`ctx.on("tools/pre-execute")`、`sessionProjections`；
4. 一次性语义清晰：**授权 = 一个 step 的可见性 + 一次消费**，用完即收。

### 7.2 最小实现骨架（示意，非最终代码）

```js
// ① 目录：让模型知道「有哪些工具、干什么用的」，但不给 schema
ctx.systemPrompt.section({
  name: "toolset:catalog",
  order: ..., 
  text: () => {
    const hidden = [...ctx.tools.view(undefined).visible.values()]
      .filter(d => !ctx.tools.view(agent).visible.has(d.name))
      .map(d => `- ${d.name}: ${d.description.split("\n")[0]}`);
    return hidden.length ? `工具目录（未授权，需 request_tool 申请）：\n${hidden.join("\n")}` : "";
  },
});

// ② 元工具 request_tool
ctx.tools.register(defineTool({
  name: "request_tool",
  description: "为一个当前工作台未授权的工具申请一次性使用权。参数只需给出工具名；批准后该工具会在下一步出现，可调用一次。",
  parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  output: { schema: {...}, render: ... },
  async execute(args, exec) {
    const def = ctx.tools.view(undefined).visible.get(args.name);
    if (def === undefined) return { error: "unknown tool" };
    if (args.name === "run_code" || args.name === "request_tool") return { error: "reserved" };
    const outcome = await ctx.approval.request({
      agent: exec.agent, toolName: args.name, callId: exec.callId,
      reason: `grant one call of ${args.name}`,
      displayReason: `模型想临时使用 ${args.name}（一次）`,
      signal: exec.signal,
    });
    if (outcome !== "allowed-once") return { granted: false, outcome };
    grants.add(exec.agent.session.id, args.name, exec.callId);  // 进程内一次性授权
    disposer = ctx.tools.restrict({ deny: [args.name] });        // 先保存，再解除
    disposer();                                                  // 解除后下一步出现
    return { granted: true, note: "该工具将在下一步可用，且只能用一次；参数见其 schema。" };
  },
}));

// ③ 执行前守卫：授权必须被「消费」，否则拒绝
ctx.on("tools/pre-execute", async (exec, next) => {
  if (exec.agent === undefined) return next();
  if (grants.has(exec.agent.session.id, exec.name)) {
    if (!grants.consume(exec.agent.session.id, exec.name)) {
      return { kind: "deny", reason: `"${exec.name}" 的本次授权已用完；如需再用请重新调用 request_tool` };
    }
    return { kind: "allow" };            // 已批准，跳过二次询问
  }
  return next();
}, { prepend: true });

// ④ 收回：调用结束 / 轮次结束（turn/end 是 session 事件，不是 ctx 事件）
ctx.on("tools/result", (exec, result) => { if (granted(exec)) reapplyRestrict(); });
ctx.on("session/event", (session, event) => {
  if (event.type === "turn/end") { clearGrants(session); reapplyRestrict(); }
});
```

要点：

- `reapplyRestrict()` 不能简单地再 `restrict` 一次（会叠加）；应当**持有**原限制的 disposer 并「解除→重新施加」，或把「授权集合」做成 `when` 条件，让限制本身不变；
- `turn/start` / `turn/end` 是**会话事件**（`dsh-agent-loop/lib/index.js:731`、`:819` 的 `session.append("turn/start"|"turn/end", ...)`），插件通过 `ctx.on("session/event", (session, event) => ...)` 观察（`dsh-user-questions/lib/index.js:514` 就是这么清理超时提问的）；`tools/result` 才是 ctx 事件（`pipeline.js:578-596`）；
- 如果产品的工作台是把工具**不注册**给会话（而不是 restrict），则 §7.2 的 `view(undefined)` 也拿不到目标工具——此时必须改为「**全局注册 + 会话 restrict**」的架构，否则 (a)(b) 都无解（这是本方案最大的前置依赖，见 §8）。

### 7.3 备选：(a) 转发，用在「模型只需要跑一次、不想多一轮」的场景

如果产品不希望改变 tools 数组（例如担心 prompt cache、或希望结果立即返回同一条消息），用 §5.a 的转发管线；把「双重弹窗」用 callId 白名单消掉，并保留 guard。

### 7.4 明确不推荐

- **(c) 单独用**：隐藏工具根本进不到 guard；文案只能当兜底提示。
- **直接 `def.execute()`**：绕过 guard 与审批，且 `exec` 形状不完整，容易在未来版本漂移。
- **自建「永久允许」存储**：与 `approval` 的词汇表（只有 `allowed-once`）和 README 的设计意图冲突；如果一定要，走 §6 的会话事件+投影，并明确它是插件级能力而不是 approval 语义。

---

## 8. 不确定 / 需实测的地方

1. **「工作台」的隐藏方式未知**：如果它靠 `ctx.tools.restrict()`（在 `agent.ctx` 上）实现，则 §5.a 的 `view(undefined)` 能看到被隐藏工具，方案成立；如果是**按会话不注册**（composition 层），则连名字都拿不到，必须先改造注册方式。这一点决定了整个方案的可行性边界，建议先确认。
2. **`defer_loading` 在供应商侧的语义**未在仓库内验证（适配器只负责打标记，`dsh-llm-deepseek:1742`）。
3. **`intent.kind === "approval"` 三按钮 UI 的渲染实现**未定位（`always` 字段存在但无生产者；可能在未解出的 client 包里）。
4. **`approval/request` 的 Host 端应答者链路**只确认了两端（`api-remotes` 转发 `mode:"waterfall"`，`client.js` 用 `ctx.remote.$on` 接），中间「哪一端把 pending 变 answerable」的实现未逐行读过。
5. **`userQuestions.ask` 在「无 UI 的 Web 会话」里会怎样**（`NO_PROVIDER` 具体触发条件）未实测。
6. 本次未读：`dsh-mcp-client`（MCP 工具是否有独立的批准/白名单）、`dsh-acp`（机器通道如何应答 `callId` 审批）、`dsh-client-ui-action-cards` 类呈现包（若存在）。

---

## 附录：本报告引用到的文件

| 文件 | 用途 |
|---|---|
| `dsh-user-approval/lib/index.js`、`lib/types/index.js`、`README.zh.md` | 批准服务、请求/结果结构、策略与限制 |
| `dsh-client-ui-approval/lib/client.js` | 批准卡片 UI、允许/拒绝动作 |
| `dsh-api-remotes/lib/index.js` | `approval/request`、`user-questions/request` 的 Host→Client 转发 |
| `dsh-tools/lib/pipeline.js` | 执行管线顺序、`serviceAsk`、guard、dispatch |
| `dsh-tools/lib/index.js` | `register/restrict/view/get/executable/resolve/definitions/schemas/guard/checkGuards` |
| `dsh-tools/lib/types/pipeline.js` | 管线 TS 面（与 bundle 同源，JSDoc 更全） |
| `dsh-scope/lib/index.js` | `ScopedLayers.chainLayers`：解释「全局视图不受作用域限制影响」 |
| `dsh-tool-ask-user/lib/index.js` | `ask_user_question` 的参数/返回值、`ctx.userQuestions` 用法 |
| `dsh-user-questions/lib/index.js`、`lib/typert.host.js` | 提问服务、`intent:`approval`` 类型与校验 |
| `dsh-permission-presets/lib/index.js` | 预设 = 沙箱模式 + 批准策略；事件/投影写法 |
| `dsh-sandbox-policy/lib/index.js` | 文件沙箱模式与模型可见文案 |
| `dsh-authorization/lib/index.js` | 凭据流程（与工具权限无关） |
| `dsh-sandbox/lib/index.js` | `approveEscalation` 一次性升级范式 |
| `dsh-tool-bash/lib/index.js` | `sandbox_permissions` → 批准 → 单次升级的完整实现 |
| `dsh-experimental-auto-review/lib/index.js` | `pre-execute` 返回 `ask` 的范本（含 `next()` 叠加策略） |
| `dsh-tool-executor-ptc/lib/index.js` | 自定义 `ToolExecutionPipeline` source、嵌套派发 |
| `dsh-agent-loop/lib/index.js` | 每步 `tools.resolve`、`request/header(change)`、`tool-addition/removal` |
| `dsh-llm/lib/index.js`、`dsh-llm-deepseek/lib/index.js` | `deferLoading` → `defer_loading` 投影 |
| `dsh-subagent/lib/index.js`、`lib/types/descriptor.js` | `toolFilter` 持久化 + `restrict`/`guard` 用法 |
| `dsh-plugin-manager/lib/types/tools.js`、`lib/types/build-approval.js` | 持久批准的先例（`allowBuilds`） |
