# 实施计划与实测进度

> v2 · 2026-11-16（客户端 UI 落地之后更新）。设计见 `design.md`，取舍见 `DECISIONS.md`。
> 现状：host 内核与客户端 UI 都已实现并在浏览器里目视验证过；单测 30/30、端到端 15/15。

## 0. 进度总览

| 阶段 | 状态 | 证据 |
|---|---|---|
| P0 风险验证 | 完成 | §1 四条全过；两条否定结论已写进验收口径 |
| P1 host 内核 | 完成 | §2 的 12 个模块；`node --test` 30/30 |
| P2 客户端 UI | 完成 | §4：三处插槽在 web 端渲染并完成选择/冻结/增删改的点击验证 |
| P3 集成与验收 | 部分 | §3 端到端 15 项全过；11 条验收里 9 条全过，1 条部分（轮末收回只有单测）、1 条未端到端（子代理） |
| P4 安装与发布 | 完成 | headless、web、desktop 三个 profile 均已用 `link:` 挂载并验证；未打包发布 |

## 1. P0：先证伪再动手（已完成）

| # | 验证 | 通过标准 | 结果 |
|---|---|---|---|
| V1 | restrict 在 agent 创建时生效，且真的不进请求体 | 请求体顶层 `tools` 只剩 allow 里的 | 通过：只剩 `grep, pwsh, read`，host 的 60+ 工具全部不在 |
| V2 | 目录 section 能注入且随会话变化 | system 里出现目录文本 | 通过：`systemPrompt.section` 落进 system；回调 context = `agent / scope / signal / modelSelection / toolSet` |
| V3 | 审批卡片能在工具调用里弹出并返回 `allowed-once` | 允许/拒绝都能拿到结果 | 通过：`ctx.approval.request` 返回 `allowed-once`，结果回到模型 |
| V4 | 客户端能进 composer / header 插槽，并读投影 | 页面出现内容、能读投影 | 通过：三处插槽都渲染过（胶囊、头部标签、设置页分区） |

补充结论：

- **本地挂载**：profile 里 `link:` 安装是 junction，改源码重启即生效；`file:` 是复制。client bundle 形如 `window.__ModuleLoader__.load({ id, factory })`；`apply(ctx)` 里的槽位必须写在 `ctx.inject(["slots"], (scope) => …)` 内，否则抛 `cannot get property "slots" without inject`。
- **host→client 通道**：不必手写 typert。客户端 `ctx.inject(["sessions"])` 拿到 `sessions.binding(sessionId)`，用 `binding.session.projections.faceOf(key)` 读投影、`binding.session.command("/…")` 发命令。
- **缓存基线**：未测。headless 每次开新会话，量不到真实前缀命中；留到 P3 用真实账号看 `cacheReadTokens`。

两条否定结论（验收口径）：

- `tools.view()` **不能**当掩码验收依据：restrict 之后 `view()` 仍返回未掩的工具（它看的是 own 层）。是否生效只看请求体顶层 `tools`。
- 会话标题生成是另一个 agent，不受会话掩码和目录影响（那一次请求 `tools` 为空）。

## 2. P1：host 内核（已完成）

模块与职责：

| 文件 | 职责 |
|---|---|
| `src/core.js` | CORE 17 名单、`REQUEST_TOOL`、两个事件类型常量 |
| `src/config.js` | 配置路径（`$DSH_HOME/plugin-data/dsh-toolset/workbenches.json`）、默认值、整体校验、原子写（tmp → rename，保留 `.bak`）、读坏文件时降级不覆盖 |
| `src/store.js` | 纯逻辑：增删改查、id 生成（`b` + 36 进制时间 + 计数器）、名称唯一与 30 字上限、全局∩普通互斥、`resolve()` 解析冻结快照 |
| `src/service.js` | Cordis `Service`（`ctx.workbenches`），把 store 的方法转出去 |
| `src/session.js` | `scanWorkbenchEvents()`（纯函数）与 `createSessionRecorder()`（`selected`/`frozen` 两个写入器，载荷带 `at` 时间戳） |
| `src/projection.js` | 投影 `workbench`：状态扁平 `{benchId,name,selected,started,core,global,bench,allowed}`，视图追加 `deleted`，未选过时回落到 `lastSelected` |
| `src/mask.js` | 掩码引擎：`attach()`、`allowedNames()`（按 `restrictableNames` 过滤 + 无条件放行 `request_tool`）、`reapply()`（先 dispose 再 restrict）、`onTurnStart()`（首次冻结，`queueMicrotask` 写事件）、`onTurnEnd()`（清 grants）、子代理继承父快照 |
| `src/catalog.js` | `systemPrompt.section`（`workbench:catalog`，order 9000），只列不可用工具，`名字：首句（归属）` |
| `src/request-tool.js` | `request_tool({tool, reason})`：校验 → `ctx.approval.request` → grant → 重建掩码；三种返回文案 |
| `src/command.js` | `/workbench` 兜底命令（无 UI 环境下查看与选择） |
| `src/http.js` | `/dsh-toolset/api` 前缀路由：`GET /state`、`GET /tools` 与七个写路由；`requestRejection` 鉴权失败返回 403；写操作在 degraded 时 409 |
| `src/index.js` | `name`/`inject`/`apply()`：装配服务、投影、目录、申请工具、命令、HTTP 路由、`agent/created`、`session/event` 挂接 |

单元测试（`node --test`，30 个用例）：

- `test/config.test.js`：默认配置、读写往返、损坏文件降级、原子写与 `.bak`、版本与字段校验、名称长度。
- `test/store.test.js`：创建/重命名/删除、重名拒绝、全局与普通工作台互斥、`moveToGlobal` 的移除计数、`setTools` 去重、`lastSelected`、`resolve()` 快照、删除后的 `deleted`。
- `test/catalog.test.js`：首句截断、80 字上限、归属标签（全局/工作台/未分类）、空目录。
- `test/projection.test.js`：未选过的会话回落到 `lastSelected`、主动选「无工作台」保持空、frozen 覆盖回落、删除后的 `deleted`。
- `test/mask.test.js`：挂载已有会话不立即掩码、选择工作台不立即掩码、`turn/start` 才按「核心 ∪ 工作台 ∪ `request_tool`」施加、可见集为空或只剩 `request_tool` 时整体跳过（这条守的是桌面端那次 `400 INVALID_REQUEST: tools: at least one tool must have defer_loading=false`）。

## 3. 端到端验证（已完成）

`node scripts/e2e/run.mjs`：脚本自建临时 `DSH_HOME`（`os.tmpdir()`）+ `profiles/headless`（依赖 `link:<repo>`、`node_modules/dsh-toolset` 为 junction、`dsh.profile.bundles` 含本插件）+ 写一份 `workbenches.json`（办公台 = read/grep/edit，全局 = pwsh）+ overlay（模型指向 `deepseek-official/deepseek-flash`、插入自动批准的 approver）+ 起 mock 模型（默认 `127.0.0.1:8811`）+ 用真实 `dsh.cmd` 跑一次 headless 任务，最后断言抓到的请求体。

15 项断言覆盖：mock 就绪、headless 干净退出、模型收尾、审批被自动批准、请求数、允许工具在列、工作台外工具被扣留、目录进 system、目录标出当前工作台、目录标「未分类」、`request_tool` 仍在、标题 agent 未被掩码、批准后同一轮请求新增工具、harness 声明 `tool_addition`、无请求被拒。

实测数据（同一 task，「不挂插件」对照 vs 「挂插件 + 办公工作台」）：

| 指标 | 对照 | 挂插件 | 变化 |
|---|---|---|---|
| 请求体首个对话请求 | 61,448 字节 | 42,316 字节 | −19,132 字节（−31%） |
| 工具数 | 24 | 12 | −12 |
| system 文本 | 2,758 字符 | 3,279 字符 | +521 字符（多了目录） |
| 工具 schema 体量 | — | — | 少约 19.6K 字符 |

踩坑记录（脚本已固化）：

1. provider 必须用 `deepseek-official` + 假 `DEEPSEEK_API_KEY`；用 `deepseek-account` 配自定义 `DEEPSEEK_BASE_URL` 会被 `ACCOUNT_SIGN_IN_REQUIRED` 挡下。
2. `--approval-policy never` 会在审批监听器之前直接拒绝，`request_tool` 只能看到「用户没有批准」；必须用 `ask`，由测试用 approver 自动批准。
3. 端口别用 8799/8802（历史 mock 进程占用），默认 8811。
4. 不要 `Copy-Item` 复制旧 DSH_HOME：它会跟随 junction 递归进仓库。改为脚本内从零生成 profile。

## 4. P2：客户端 UI（已完成）

### 4.1 交付方式（已落地）

不引入打包器：`client/client.js` 手写浏览器模块，`window.__ModuleLoader__.load({ id: "dsh-toolset", factory(require) { … } })`，只 require `react`；样式在 JS 里注入 `<style data-plugin-css="dsh-toolset">`，颜色只用 `--dsw-alias-*`。`package.json` 已加 `exports["./client"]`、`files` 里的 `client`、以及 `dsh.client = { platform: "web", immediately: true }`。

### 4.2 三块 UI（已实现并点击验证）

1. **composer 胶囊**（`conversation.input.right`，order 5）：显示当前工作台或「无工作台」；菜单列「无工作台」+ 各工作台（带工具数）；冻结后按钮禁用并提示「已冻结」。
2. **会话头部标签**（`conversation.session.header.actions`，order 10）：`工作台：X`；冻结后 `data-frozen` 变绿、带工具数，`title` 为「工作台：X（已冻结）」。
3. **设置页分区**（`settings.section`，order 18，`label:() => "工作台"`）：新建、改名（失焦提交）、删除（两次点击确认）、每个工作台的工具勾选、全局工作台、未分类清单（点一下移到全局）、degraded 横幅、readOnly 时整体禁用。

### 4.3 数据通道（已落地：host 前缀路由）

- **读**：会话投影走插槽 props 里的 `useProjection("workbench")`（`{benchId,name,started,core,global,bench,deleted}`）；设置页走 `GET /dsh-toolset/api/state` 与 `GET /dsh-toolset/api/tools`。
- **写**：`POST /dsh-toolset/api/select`（`{sessionId,benchId}` → `engine.select`）、`/bench`、`/bench/rename`、`/bench/remove`、`/bench/tools`、`/global`、`/tools/move-to-global`；每个写路由都回同一份扁平 state（`global` 是字符串数组）。
- **鉴权**：handler 里 `ctx.connection.requestRejection(req) !== undefined` → 403；浏览器同源 `fetch` 自带 cookie，客户端不传任何 header。路由用 `ctx.inject(["webServer","connection"], scope => scope.effect(…))` 注册，headless 没有 `webServer` 时这段不加载。
- **工具清单**：插件根 `ctx.tools.view()` 只看得到自己这一层，`toolCatalog()` 对 `ctx.agents.list()` 逐个 `ctx.tools.view(agent)` 取并集、再并根视图兜底；实测 34 个工具（含 `request_tool`）。
- **不用 `session.command` 承载数据**：命令结果只有 `{kind,text}`，读不到结构化返回；选中工作台直接走 `/select`。

### 4.4 目视验证与踩坑

开发环境：`tmp/devhome`（临时 `DSH_HOME`）+ `profiles/toolsetweb`（bundles 含 `@deepseek-ai/dsh-web-app` 与本插件的 `link:`）+ `dsh --profile toolsetweb --port 8977 --no-open`；浏览器用 agent-browser 打开启动日志里的 `?token=…` 地址（每次启动都变）。

已验证：胶囊出现并能选中「办公」；选中后头部标签出现 `工作台：办公`；发出首条消息后标签变「已冻结」、胶囊禁用；设置页新建「测试台」、改名「临时台」、二次确认删除；勾选工具落盘；未分类 chip 点一下进全局。

UI 暴露过两个 API 形状 bug（已修）：`/state` 曾把 `global` 原样透出成 `{tools:[…]}` 对象（客户端 `new Set()` 抛 *object is not iterable*）；`POST /bench` 曾返回 `{bench}` 而非整份 state（客户端 `config.benches is not iterable`）。教训：**每个写路由都回同一份 state 形状**；单测与 headless e2e 只测 host 逻辑，抓不到这类契约漂移。

desktop 安装暴露出一个 host 侧时序 bug（已修，见 `design.md` §5.2 与 D31）：`install_bundle` 对已经在运行的会话调用 `attach()`，此时 `state.core/global/bench` 还是空的，`restrict` 只留下 `request_tool`，DSH 把历史工具都投影成 `defer_loading`，服务端回 `400 INVALID_REQUEST: tools: at least one tool must have defer_loading=false. All tools cannot be deferred.`（会话日志 `assistant/attempt` 的 finish 里能查到原文）。修法：挂载与选择都只记录，掩码只发生在 `turn/start`；`reapply` 在 allow 为空或只剩 `request_tool` 时跳过。e2e 抓不到它——e2e 的 agent 是新建的，`attach` 那一刻 `restrictableNames` 还没有 `request_tool`，allow 为空被旧守卫跳过；只有挂到已有会话、且视图里已经有 `request_tool` 时才触发。

## 5. P3：集成与验收

按 `design.md` §7 的 11 条：

| # | 验收项 | 状态 |
|---|---|---|
| 1 | 默认值（上次选择 / 无工作台） | ✅ 未选过的会话胶囊显示上次的工作台（投影回落 `lastSelected`）；主动选「无工作台」后保持空 |
| 2 | 胶囊可选、发出首条消息后禁用、刷新后标签仍在 | ✅ 胶囊选中生效；首条消息后胶囊禁用（不消失）、头部标签出现，刷新后仍在（冻结态由投影承载） |
| 3 | 请求体只含 CORE ∪ 全局 ∪ 当前工作台 | ✅ e2e 已断言 |
| 4 | 设置页增删改、互斥、未分类计数 | ✅ 新建/改名/两次确认删除/勾选落盘/未分类 chip 移入全局，均在浏览器里点过 |
| 5 | 目录正确（名字/用途/归属，有效集不出现） | ✅ e2e + 单测 |
| 6 | 申请 → 批准 → 本轮可用、轮末收回 | ✅ 批准路径已 e2e；轮末收回只有单测（`onTurnEnd` 清 grants） |
| 7 | 冻结：改配置不影响已开对话 | ✅ 单测（快照解析与冻结）；会话内改配置未实测 |
| 8 | 删除工作台：老对话继续可用、标签显示「（已删除）」 | ✅ 投影标 `deleted`、标签显示「（已删除）」；老对话工具集来自 frozen 快照 |
| 9 | 子代理可用工具与父会话一致 | 代码已实现；端到端未覆盖 |
| 10 | 不装插件行为不变 | ✅ 对照运行 |
| 11 | 插件热装到已运行的会话后，第一轮不因空工具集失败 | ✅ desktop 上真实复现过 `400 INVALID_REQUEST: tools: at least one tool must have defer_loading=false`（见 `design.md` §5.2、D31）；改为只在 `turn/start` 掩码后，本轮对话正常 |

待补的测量：

- **真实缓存**：用真实账号跑连续三轮，记录 `cacheReadTokens`；再跑一次「中途授权」看 miss。这一项需要可用凭据，暂缺。
- **token 精确值**：现有数字是请求体字节与字符数，够用；若要写进 README，换算成 token 时注明估算方法（字符数 / 3.5 左右）。

## 6. P4：安装与发布

- **已验证的安装路径**：headless profile 用 `link:` + `dsh.profile.bundles` 挂载，`dsh-toolset` 正常加载并生效（e2e 即此路径）；web 端用同样的 `link:` 起临时 profile（工具 8977 端口）并完成目视验证。
- **desktop 已安装（`plugin_manager` 的 `install_bundle`）**：目标为仓库绝对路径 `D:\PersonalFiles\PersonalProjects\dsh-toolset`，返回
  `{"stage":"enable","target":"dsh-toolset","enabled":true,"changed":true,"application":"applied","bundle":"dsh-toolset","version":"0.1.0","warnings":[]}`。
  装完后 `profiles/desktop/package.json` 的 `dependencies` 出现 `"dsh-toolset": "link:D:/PersonalFiles/PersonalProjects/dsh-toolset"`、`dsh.profile.bundles` 出现 `"dsh-toolset"`，`node_modules/dsh-toolset` 是 Junction。pnpm 会对 `@deepseek-ai/cordis@*`、`@deepseek-ai/dsh-session@*` 两个 peer 依赖告警，宿主提供，不影响运行。
- **装的顺序很重要**：先写 `plugin-data/dsh-toolset/workbenches.json` 再安装。否则首次生效时配置为空、`degraded` 为真，掩码整体关闭；补上配置后需要等一次配置读取。安装即对当前进程生效，不需要重启。
- **生效后的观感**：当前会话的工具集立刻收窄为「核心 18 ∪ 全局 ∪ 当前工作台」，系统提示末尾追加目录；原来能用的工具大批变成「已安装但本对话不可用」。
- **可选**：`npm pack` 出 tgz，验证 `file:` 安装；暂不发布公共目录。

## 7. 风险登记

| 风险 | 触发条件 | 应对 |
|---|---|---|
| restrict 语义随版本变化 | DSH 升级 | e2e 用请求体断言，升级后先跑它 |
| 设置页数据通道不可行 | P2 | 退到全部走 `session.command`，设置页只读 + 命令写 |
| 客户端插槽改名 | DSH 升级 | 只用公开 slot 名；失效时先修 P2 |
| 模型不会用 `request_tool` | 真实使用 | 工具描述写清场景 + 目录里给示例 |
| 真实缓存收益未证实 | 有账号后 | 记录 `cacheReadTokens`，如实写进 README |

## 8. 交付物清单

已存在：

- `src/`：host 实现（12 个模块）
- `client/client.js`：客户端 UI（三块插槽 + 设置页，手写浏览器模块）
- `test/`：5 个测试文件，30 个用例
- `scripts/e2e/`：`run.mjs`、`mock-llm.mjs`、`approver.js`
- `package.json`、`cordis.patch.yml`、`icon.svg`、`locale/{en,zh}.json`、`.gitignore`
- `README.md`：定位、安装、配置、开发与状态
- `docs/`：`design.md`、`plan.md`、`DECISIONS.md`、`research/*.md`

待补：

- 无。真实 `cacheReadTokens` 受账号凭据限制，见 §5。
