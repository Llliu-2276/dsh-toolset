# dsh-toolset

为 DeepSeek Harness 增加「工作台」：每个对话在开始时选一组工具，之后每次请求只发送这组工具的完整定义；其余已安装工具只以「名字 + 一句话用途」的形式出现在系统提示里，需要时由模型申请、用户批准后临时放行。

## 为什么

DSH 每次请求都会把当前可用工具的定义（名称、描述、参数 schema）整包发给模型。工具装得多时，这部分固定开销能到上万字——而且大部分和当前任务无关。工作台把这份开销换成一次显式的选择：

- 有效集 = CORE（17 个必备工具 + `request_tool`）∪ 全局工作台 ∪ 当前工作台。
- 有效集之外的工具**不进请求体**，只在系统提示的目录里留一行说明。
- 目录常驻约 200–1200 字符，远小于被省下的工具 schema。

实测（同一任务，headless + 24 个工具的环境）：挂插件并选一个 3 工具的工作台后，首个对话请求体 61,448 → 42,316 字节（−31%），工具数 24 → 12。

## 安装

需要 DSH 0.2.2-rc.1 或更新版本。

**自定义 profile（开发机）**：

```powershell
dsh plugin --profile <profile> add <本仓库路径或包名>
```

这条命令把参数转发给 profile 目录里的 pnpm；装完后自动把带 `dsh.bundle` 的新依赖追加进 `dsh.profile.bundles`，不需要手改 profile 文件。本地目录以 `link:` 记入依赖，等于 junction，改完源码重启 DSH 即生效。若 profile 还不存在，这条命令会先用默认模板初始化它，并在 stderr 打印 `dsh: initialized profile <name> at …`。

**桌面应用**：desktop profile 由 Electron 独占管理（CLI 会拒绝），改用插件管理器的 `install_bundle`，`target` 填本包的绝对路径。装完即对当前进程生效：本包会立刻把每个对话的工具集收窄为「核心 ∪ 全局 ∪ 当前工作台」，所以**先写好 `<DSH_HOME>/plugin-data/dsh-toolset/workbenches.json` 再安装**，否则配置为空、掩码默认关闭。

卸载：`dsh plugin --profile <profile> remove dsh-toolset`。

## 配置

配置文件：`$DSH_HOME/plugin-data/dsh-toolset/workbenches.json`（`DSH_HOME` 缺省为 `~/.dsh`）。

```json
{
  "version": 1,
  "lastSelected": "bm3k1a2",
  "global": { "tools": ["x_search"] },
  "toolOrder": ["univer_sheet", "univer_doc", "x_search"],
  "benches": [
    { "id": "bm3k1a1", "name": "办公", "description": "表格、文档与幻灯片", "tools": ["univer_sheet", "univer_doc"], "createdAt": 1763316000000 }
  ]
}
```

- 一个工具不能同时在全局工作台和普通工作台里；可以同时属于多个普通工作台。
- 不在任何工作台里的已安装工具默认不发给任何对话，仍然可以被模型申请授权。
- `description` 是工作台的一句话介绍（可空，上限 200 字）；`toolOrder` 是设置页里工具卡片的显示顺序，只影响 UI。
- 写在会话第一条消息发出时冻结：之后改配置只影响新对话。
- 文件损坏时插件不覆盖它，而是退化为「全部工具可用」并在日志里报警。

## 行为

- **会话开始时**：若 `lastSelected` 指向一个存在的工作台，则使用它；否则「无工作台」。
- **第一条消息**：写 `plugin:dsh-toolset/frozen` 事件（快照里存解析后的工具名），投影 `workbench` 从此只读。
- **每轮结束**：收回本轮批准过的临时授权。
- **子代理**：继承父会话冻结的工具集，不继承父的临时授权。
- **目录**：系统提示里的 `## 其他已安装的工具` 一节，列 `名字：一句话用途（归属）`，只列当前对话用不了的工具。
- **申请**：模型调用 `request_tool({ tool, reason })`，弹原生审批卡（只有「允许一次 / 拒绝」）；允许后本轮可直接调用。

## 界面

装好后在三处出现：

- **输入框里的胶囊**：显示这个对话将使用的工作台（默认是上次选的那个）；点开可换，第一条消息发出后固定。选中「无工作台」就只发 CORE 工具。
- **会话标题右侧的标签**：`工作台：办公 · 12 个工具`，冻结后变绿；工作台被删掉时显示「（已删除）」。
- **设置 → 工作台**：一行可横向滚动的工作台卡片（全局固定在最左，右侧固定一个「+」新建卡片），点卡片即选中、右上角铅笔改名称与介绍、垃圾桶四秒内点两次删除；下方是工具卡片列表，点一下加入/移出当前工作台，已在全局的工具置灰不可点；工作台与工具都能拖动排序。

图标是线条版「我的世界工作台」，出现在输入框胶囊、会话头部标签、设置页卡片、设置左导航和插件列表里；素材在 `assets/crafting-table/`，实现说明见 `docs/design.md` §3.3。

没有 UI 的环境（headless）用 `/workbench` 命令：不带参数列出现有工作台，`/workbench 办公` 选一个。

## 开发

仓库不引入构建步骤：host 是纯 ESM，`main` 直接指向 `src/index.js`；客户端 `client/client.js` 是手写浏览器模块（`window.__ModuleLoader__.load`）。

```powershell
node --test            # 单元测试（71 个用例）
node scripts/e2e/run.mjs   # 端到端：真实 headless 会话 + mock 模型，断言请求体
```

端到端脚本需要的环境：

- `DSH_BIN`：`dsh` 启动器路径，缺省 `D:\Software\Agent\DeepseekHarness\dsh\resources\runtime\cli\bin\dsh.cmd`。
- `MOCK_PORT`：mock 模型端口，缺省 8811。
- `KEEP=1`：保留临时 `DSH_HOME` 便于排查。
- 可用 `DSH_BIN` 指向任意版本的启动器；脚本自建 profile，不碰你自己的 `~/.dsh`。

## 目录

```
src/          host 实现（配置、store、掩码、目录、申请工具、投影、命令、HTTP 路由）
client/       客户端 bundle（三块插槽 + 设置页，手写浏览器模块）
assets/       图标素材（线条版工作台 SVG 与预览图）
test/         单元测试（node:test）
scripts/e2e/  端到端验证（临时 DSH_HOME + mock 模型 + 自动批准）
docs/         design.md（设计）、plan.md（进度与实测）、DECISIONS.md（决策）、research/（调研）
```

## 状态

host 与客户端 UI 都已实现：host 通过 71 个单测与 15 项端到端断言；设置页是卡片式布局（工作台卡片行 + 工具卡片列表 + 拖动排序 + 新建/编辑弹窗），配色全部改用宿主 `--dsw-*` design token，浅色深色同一套样式，整页自己限高与滚动，所以底部留白不会被宿主面板裁掉。尚未做的：真实账号下的缓存命中测量、子代理端到端断言、真实界面里的鼠标拖动操作。详见 `docs/plan.md`。
