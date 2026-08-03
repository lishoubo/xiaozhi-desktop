# 小智桌面端架构评审：以“订单来了”为参照

评审日期：2026-08-01

## 1. 评审范围与结论

本报告基于以下材料进行静态评审：

- 当前仓库的 Electron main、preload、renderer、shared、Forge 配置及测试。
- `/Users/lishoubo/p/projects/rms-desk-app-docs/docs` 中的订单来了方案、订单流、内嵌浏览器、工具层、Skill、技术选型和开源参考资料。
- 参考文档记录的订单来了安装包与登录后运行态只读观察。

本次没有反编译或运行订单来了，也没有对当前应用进行真实 OTA 登录、Cookie 导入和线上网络调用。因此，关于订单来了云端内部实现的内容仍是参考文档基于公开资料与客户端行为作出的推断，不应当当作其官方架构说明。

### 总结判断

当前项目作为 **Electron 多渠道浏览器原型**，基础质量是合格的：进程边界清楚，远程页面禁用了 Node，preload API 较小，IPC 会校验 sender，权限默认拒绝，日志有脱敏约束，测试也覆盖了若干关键边界。

但它还不是“类似订单来了”的业务架构，目前更准确的形态是：

```text
Svelte 应用壳
  + 单一共享 Chromium session
  + 按渠道分组的内存页签
  + 全局 Cookie 导入
  + Agent 静态演示页
```

订单来了桌面端则更接近：

```text
workspace/account/tab + 每账号独立 partition
  + 持久化渠道与登录上下文
  + Electron 浏览器能力
  + 受控 tool bridge / MCP
  + 独立 Agent runtime
  + 云 PMS / Channel Manager 业务主链路
```

两者真正的差距不是页面数量，而是 **账号隔离、上下文模型、状态权威、执行边界和业务闭环**。

在继续增加渠道、订单、Agent 或 RPA 功能之前，建议先解决两个阻断级问题：

1. 把全局共享 session 改成按账号隔离的 partition。
2. 把外部导航从“允许任意 HTTP(S)”改成渠道清单驱动的导航策略。

如果不先处理，后续多账号登录、任务定位、权限审计和 Agent 执行都会建立在错误的基础上，迁移成本会快速上升。

## 2. 订单来了架构中真正值得参考的部分

参考文档对订单来了的总体判断是“云 PMS / Channel Manager 主链路 + 桌面 AI 与浏览器侧链路”，不是纯 RPA 抓单工具。其推断架构见 `orderlaile-solution-analysis.md:700-738`，订单主链路见同文件 `:740-777`。

### 2.1 云端业务主链路与桌面侧链路分开

订单、库存和价量态的权威数据在 PMS / Channel Manager；桌面端负责渠道登录、session 维护、巡检、异常处理、用户接管和 AI 工具执行。参考文档将其概括为：

```text
订单/库存主链路：云 PMS / Channel Manager / API
后台操作补洞：内嵌浏览器 / browser tools / AI Agent
```

这对本项目最重要的启发不是“必须自建 PMS”，而是必须明确自己的数据权威：第一阶段外部 OTA/PMS 仍是权威，本地只能保存采集事实、标准化事件、任务记录和执行证据，不能把一次页面抓取结果伪装成实时库存事实。

### 2.2 Workspace / Account / Property / Tab / Profile 是一等模型

订单来了把页面组织成 `workspaceId -> accountId -> tabId`，并把门店上下文、登录状态和 profile 纳入同一套模型。参考证据见：

- `orderlaile-solution-analysis.md:781-809`
- `orderlaile-competitor-order-flow.md:539-581`
- `orderlaile-competitor-order-flow.md:600-680`

这套模型解决的是“谁在什么门店、用哪个账号、在哪个页面、以什么登录态执行任务”，不是单纯为了展示浏览器标签。

### 2.3 每账号独立 Chromium partition

订单来了观察到的 partition 命名形态为：

```text
ddlldesk:prod:<workspaceId>:<accountId>
```

Cookie、Local Storage、IndexedDB、Service Worker 等完整浏览器状态随账号隔离，而不是只隔离 Cookie。参考证据见 `orderlaile-competitor-order-flow.md:744-801` 和 `orderlaile-browser-tool-deep-dive.md:87-101`。

### 2.4 Context First

工具先通过 `pms_get_context` 确定门店、登录态和 API 基址，再执行查询或变更。上下文不完整时拒绝执行。这避免 Agent、RPA 和业务代码到处散传 token、URL、门店 ID，也能阻止“操作了错误账号/门店”这一类高风险错误。

### 2.5 工具协议与浏览器权限分开

订单来了的 browser MCP 只负责协议适配，真正持有 `WebContents/session/CDP` 权限的是 Electron 主进程：

```text
Agent -> MCP stdio -> local bridge -> Electron main -> WebContents/CDP
```

参考证据见 `orderlaile-browser-tool-deep-dive.md:5-85`。这种边界便于统一实现工具白名单、运行时校验、超时、审批、审计和错误包装。

### 2.6 页面操作采用 snapshot/ref，而不是猜 URL 和 selector

订单来了通过 `snapshot -> ref -> click/type -> snapshot` 操作用户可见页面，并要求业务导航走真实页面元素。参考证据见 `orderlaile-browser-tool-deep-dive.md:103-129` 和 `:176-190`。

本项目不需要第一天实现完整 MCP，但 browser capability 的接口应按稳定工具契约设计，避免未来让 Agent 直接拿任意 `evaluate` 或任意 URL 权限。

## 3. 当前项目做得正确的部分

### 3.1 Electron 安全基线较完整

- 主窗口和 OTA `WebContentsView` 均设置 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`，见 `src/main/windows/window-options.ts:3-15`、`src/main/browser/browser-manager.ts:43-49`。
- preload 只暴露 browser、cookies、system 三组显式 API，见 `src/preload/api.ts:11-37`。
- IPC handler 会比较 `event.sender` 与主窗口 `webContents`，拒绝其他 sender，见 `src/main/ipc/browser-handlers.ts:41-55`。
- 嵌入页面权限默认全部拒绝，见 `src/main/security/session-permissions.ts:5-9`。
- 主渲染页有较严格 CSP，见 `index.html:6-9`。
- Forge fuses 禁止 RunAsNode、Node options 和 inspect 参数，并开启 ASAR 完整性，见 `forge.config.ts:67-75`。

这些设计应该保留，不应为了接 Agent、RPA 或远程页面而放宽。

### 3.2 主进程持有原生能力，renderer 主要负责呈现

`BrowserManager` 持有 `WebContentsView`、session 和页签生命周期，Cookie 文件读取也在 main。renderer 通过 preload/IPC 请求操作，没有直接获得 Electron 对象、数据库句柄或文件系统能力。这一方向符合后续扩展要求。

### 3.3 资源清理和日志边界已有意识

窗口关闭时注销 IPC handler 并销毁浏览器视图，见 `src/main/application.ts:21-37`。浏览器创建、关闭、加载失败以及 Cookie 导入均有结构化日志，而且现有测试会检查 Cookie 值和本地路径没有进入日志。

### 3.4 测试体系不是空白

仓库已有 unit、component、Electron Playwright E2E 三层测试，并有统一的 `check/lint/format/test:all` 脚本。当前测试覆盖了：

- 非 Web scheme 导航拦截。
- 嵌入页权限拒绝。
- IPC sender 校验。
- preload API 形状。
- Cookie 读取和日志脱敏。
- 渠道切换、Cookie 导入失败反馈和基础应用路由。

这为后续按 TDD 重构 session 和 workspace 提供了可用基础。

## 4. 架构问题与优先级

### P0-1：所有渠道和账号共享一个 Chromium session

**证据**

`BrowserManager` 构造时只创建一个固定 partition：

```ts
session.fromPartition('persist:hotel-butler-browser')
```

所有新 `WebContentsView` 都使用这个 `browserSession`，见 `src/main/browser/browser-manager.ts:24-49`。Cookie 导入也把全部受支持渠道 Cookie 写进同一个 session，见 `src/main/ipc/browser-handlers.ts:91-109`；导入器会读取多个 OTA 根域，见 `src/main/browser/cookie-import.ts:1-24`。

**影响**

- 不能同时登录同一渠道的两个账号。
- “切换渠道”只是 UI 分组，不是安全或状态隔离。
- 导入某个浏览器 profile 时，会把不同渠道 Cookie 混入一个应用 profile。
- 无法可靠回答某个任务使用了哪个账号、酒店和登录态。
- 清理、重新登录、备份和迁移只能作用于全局，容易误伤其他账号。
- 后续 RPA/Agent 即使拿到 `channelId`，也无法唯一定位凭证上下文。

**建议**

建立显式的 `BrowserContextKey`：

```ts
type BrowserContextKey = {
  environment: 'prod' | 'staging';
  workspaceId: WorkspaceId;
  accountId: AccountId;
  profileId: ProfileId;
};
```

partition 由 main 中受控工厂生成，例如：

```text
persist:xiaozhi:<env>:<workspaceId>:<accountId>
```

`BrowserManager.create` 不再接收裸 `channelId + url`，而是接收已存在、经过验证的 browser context 和 channel entry。Cookie 导入必须先让用户选择来源 profile、目标 workspace/account，并只写入该渠道允许域名的目标 partition。

不要静默把旧全局 session 复制到多个账号。升级时应保留旧 profile 作为只读迁移来源，让用户逐账号确认归属或重新登录。

### P0-2：外部导航只校验协议，没有渠道域名策略

**证据**

`assertWebUrl` 只允许 `http:` / `https:`，但不验证 host、端口、账号信息、目标渠道或本地网络地址，见 `src/main/browser/browser-manager.ts:17-22`。页面弹窗也会把任意 Web URL 创建为新页签，见同文件 `:147-165`。

renderer 传入的 `channelId` 和 `url` 只做字符串检查，见 `src/main/ipc/browser-handlers.ts:57-64`。这与仓库自己的“校验外部 URL、未知来源默认拒绝”规则不完全一致。

**影响**

- renderer 一旦被 XSS 或依赖供应链问题影响，可让 main 创建任意远程页面。
- OTA 页面弹窗可跳到非渠道站点、钓鱼站点或 `localhost`/内网 Web 服务。
- 未来增加本地 HTTP sidecar 后，嵌入页可能通过网络直接探测或调用本地能力。
- `channelId` 与实际页面 host 没有关联，审计日志中的渠道标签可以失真。

**建议**

在 main 建立 `ChannelManifestRegistry`，每个渠道定义：

```text
workspaceId
entryUrls
allowedOrigins / allowedRedirectOrigins
cookieDomains
popupPolicy
downloadPolicy
loginHealthStrategy
capabilities
```

创建页签时 renderer 只传 `workspaceId/accountId` 和可选的受控 action，不传任意入口 URL。导航策略默认拒绝：

- 未列入渠道 manifest 的 origin。
- URL 中的 username/password。
- loopback、link-local 和私网地址，除非某个受审查能力明确需要。
- 非标准端口和非 Web scheme。

OAuth/统一登录的跨域跳转应作为渠道特定 allowlist 管理，并记录拒绝事件。未来本地服务即使只监听 `127.0.0.1`，仍需随机会话密钥、Origin 校验和逐方法授权。

### P1-1：缺少账号、门店和执行上下文模型

**证据**

当前共享契约 `BrowserTab` 只有 `id/channelId/title/url/navigation/loading`，见 `src/shared/browser.ts:8-16`。渠道配置也只有 `id/name/url/iconUrl`，见 `src/renderer/data/ota-channels.ts:3-8`。

代码中没有 `accountId`、`propertyId`、`profileId`、`loginState`、`capabilities` 或上下文查询接口。

**影响**

- 页签、Cookie、任务、日志和未来订单数据无法归属到明确门店账号。
- Agent 无法在执行前证明目标上下文完整。
- 同一渠道多账号、一个账号多门店、跨店权限边界都无法自然表达。
- 后续模块会各自定义散乱参数，形成不兼容的隐式上下文。

**建议**

先定义最小领域词汇，不必同时实现完整业务：

```text
Workspace       渠道/PMS 能力空间
ChannelAccount  渠道登录账号
Property        酒店/门店
AccountBinding  账号与门店的绑定及渠道侧标识
BrowserProfile  Chromium partition/profile
BrowserTab      某 profile 下的页签
LoginHealth     登录状态、来源、时间和原因
ExecutionContext 任务/工具执行时的不可变上下文快照
```

所有 task/tool 调用必须携带或解析出 `workspaceId/accountId/propertyId/profileId`。第一阶段应明确禁止跨店 fan-out。

### P1-2：浏览器状态存在两个权威，且无法跨重启恢复

**证据**

- main 用 `Map<string, ManagedTab>` 保存真实视图和活动页签，见 `src/main/browser/browser-manager.ts:24-28`。
- renderer 又维护 `tabsByChannel` 和 `activeTabIds`，见 `src/renderer/components/browser/BrowserWorkspace.svelte:15-25`。
- renderer 根据逐个 `stateChanged` 事件自行合并状态，见同文件 `:34-40`、`:140-173`。
- 应用没有自有持久化数据库，仓库文档也明确说明当前 SQLite 只用于只读导入浏览器 Cookie，见 `docs/DATA_AND_DEPENDENCIES.md:3-14`。

**影响**

- renderer 和 main 在关闭、异步加载失败、事件丢失或快速切换时可能出现状态偏差。
- 应用重启后页签、活动账号、登录健康信息和任务关联全部丢失。
- 无法实现崩溃恢复、版本迁移、诊断还原和 Agent 对话/任务续跑。

**建议**

main 成为 workspace 状态唯一权威，renderer 只消费完整快照或带 revision 的事件。引入 repository 保存“可恢复的声明状态”，不要持久化 `WebContentsView` 这类运行对象：

```text
WorkspaceState
  -> accounts
  -> tabs(initialUrl/currentUrl/opener/primary)
  -> active account/tab
  -> login health
```

应用启动时由 main 读取状态、校验 schema version，再重建 session 和视图。写入采用原子替换或数据库事务。

### P1-3：当前只有浏览器壳，没有任务、数据和业务闭环

**证据**

`package.json` 的运行时依赖中没有 Agent runtime、任务队列、领域存储或 worker 通信组件。Agent 页明确返回“Agent 服务接入后”并只在 renderer 内保存消息，见 `src/renderer/pages/AgentPage.svelte:21-67`；组件测试也将其定义为 local preview，见 `tests/component/AgentPage.test.ts:18-29`。

当前没有：

- RPA/采集 worker 管理。
- 任务状态机、超时、取消、重试和账号级并发控制。
- 采集结果、订单事件、执行动作和证据存储。
- 订单去重/版本、取消/改期、异常 review queue。
- Agent tool registry、审批和执行结果验证。

**判断**

这是产品阶段差距，不是现有代码的局部 bug。但如果下一步直接把真实 Agent API 接到当前聊天页，架构会走偏：Agent 没有结构化数据、目标上下文和受控工具，只能分析 DOM、猜页面或调用过宽 IPC。

**建议**

不要先做“能聊天”，先做一个真实的只读纵向闭环：

```text
一个渠道 + 一个账号 + 一个门店
  -> 登录健康检查
  -> 启动一次采集任务
  -> 标准化一个订单/经营数据集
  -> 数据质量校验
  -> 保存任务、结果和诊断证据
  -> UI 展示事实
  -> Agent 基于结构化事实生成解释
```

外部 OTA/PMS 是 source of truth；本地保存 `observedAt/source/version/evidence`。任何改价、库存或订单动作都采用 `proposed -> approved -> executing -> verified/failed` 状态机。

### P1-4：尚未形成独立的 browser capability / tool 边界

**证据**

preload browser API 目前是面向 UI 的页签命令：create、activate、close、back、forward、reload、bounds，见 `src/preload/api.ts:17-28`。没有 snapshot、query、screenshot、network listener 或基于上下文定位页签的工具契约。

**影响**

后续接 Agent 时容易出现两种坏结果：

- 不断扩大 renderer preload API，让 UI 和 Agent 共同依赖 Electron 内部细节。
- Agent 直接使用任意 JS evaluate、任意 URL 或未经审批的底层 HTTP。

**建议**

在 main 内先建立与传输协议无关的 `ToolRegistry`：

```text
BrowserCapabilityHandler
BusinessCapabilityHandler
ToolPolicy
ToolExecutionContext
ToolResult / ToolError
```

第一批只读工具可包括 `list_accounts`、`list_tabs`、`snapshot`、`find`、`screenshot`、`listen_request`。写工具晚于只读工具，并统一经过：参数 schema 校验、context 解析、权限判断、超时、取消、输出限制、审计和人工确认。

MCP 是可选适配器，不应成为领域逻辑所在层。Agent runtime 建议独立进程；它只拿工具契约，不拿 `WebContents`、Cookie 或数据库句柄。

### P1-5：Cookie 导入缺少来源 profile 和目标账号语义

**证据**

Chromium 导入器会从 `Default/Profile N` 中选择最近修改的 Cookie 数据库，见 `src/main/browser/browser-cookie-importer.ts:184-193`；UI 只让用户选择浏览器产品，不展示具体 profile 或目标账号，见 `src/renderer/components/browser/CookieImportDialog.svelte:25-57`。

**影响**

- 多 profile 用户无法确认导入的是哪个登录身份。
- “最近修改”不是可靠的账号选择规则。
- 导入成功的 Cookie 数量不能证明目标渠道已经登录。
- 当前全局目标 session 会进一步放大误导入的影响。

**建议**

把流程改成：选择浏览器 -> 选择来源 profile -> 选择目标 workspace/account -> 显示允许导入的渠道域摘要 -> 导入 -> 打开目标入口 -> 执行登录健康检查。产品层不要把“写入 N 个 Cookie”等同于“账号可用”。

### P1-6：缺少浏览器故障隔离、健康检查和诊断材料

**证据**

当前主要处理初始 `loadURL` reject 和常规导航/标题事件，见 `src/main/browser/browser-manager.ts:63-71`、`:147-188`。没有看到 `did-fail-load`、`render-process-gone`、`unresponsive`、证书异常、登录状态检查、截图/trace/HTML 或网络监听诊断。

**影响**

真实 OTA 环境中，页面崩溃、登录失效、验证码、风控、白屏和接口失败无法被可靠区分；自动任务也没有恢复依据。

**建议**

建立账号级 `LoginHealth` 与页签 `RuntimeHealth`，记录状态、判断来源、更新时间和安全错误类别。增加页签崩溃重建、加载失败状态、任务超时、有限重试和用户接管入口。诊断文件进入受控 artifact store，并在导出前脱敏。

### P2-1：本地 mock 登录不是安全边界

**证据**

固定手机号和验证码在 renderer 源码中，session 只写 `localStorage`，见 `src/renderer/auth.ts:1-40` 和 `src/renderer/pages/LoginPage.svelte:39-61`。

**判断与建议**

作为演示流程可以接受，但不能用于授权 Cookie、门店数据或自动执行能力。接真实业务前，应明确用户认证与本地设备授权模型；main 对敏感操作必须依据可信授权状态，不能依据 renderer 的 localStorage。退出登录还应定义是否关闭页签、清理何种账号状态以及是否保留已授权 profile。

### P2-2：发布、更新和本地数据迁移尚未形成架构

Forge 已启用 ASAR 和安全 fuses，但没有看到签名、公证、自动更新、数据库迁移、诊断包或回滚机制。对浏览器 profile、native module、未来 worker/runtime 都属于发布敏感能力，应在进入内部试用前补齐目录约定、版本兼容矩阵和升级/回滚策略。

### P2-3：测试尚未覆盖未来最危险的行为

现有测试是良好起点，但关键缺口包括：

- 两账号 partition 与 Cookie/Storage 隔离。
- 渠道 allowlist、OAuth 重定向、popup 和 localhost/私网拦截。
- workspace 持久化与崩溃/重启恢复。
- 登录健康判断的成功、失效、验证码和未知状态。
- task 幂等、取消、超时、重试上限和账号级并发。
- Agent 工具 schema、审批、部分成功、执行后校验和敏感输出脱敏。
- 打包产物中的 native module、profile 和 runtime 行为。

这些测试应随着对应能力按 Red -> Green -> Refactor 增加，不建议现在为不存在的模块写空泛测试。

## 5. 建议目标架构

建议保留现有 Electron/Svelte 技术栈，在现有边界上演进，不需要为了“像订单来了”改用另一套桌面框架。

```text
Electron Main (composition root / trusted)
  ├─ Workspace Service
  │    ├─ Workspace / Account / Property bindings
  │    ├─ persisted workspace state
  │    └─ execution context resolver
  ├─ Browser Host
  │    ├─ SessionFactory (partition per account)
  │    ├─ TabManager
  │    ├─ ChannelManifestRegistry
  │    ├─ NavigationPolicy
  │    ├─ LoginHealth adapters
  │    └─ Browser capabilities (snapshot/network/screenshot)
  ├─ Task Orchestrator
  │    ├─ lifecycle / timeout / cancel / retry
  │    ├─ account concurrency and rate limits
  │    └─ WorkerManager
  ├─ Tool Gateway
  │    ├─ ToolRegistry
  │    ├─ runtime validation
  │    ├─ policy / approval / audit
  │    └─ MCP or socket adapter
  ├─ Persistence
  │    ├─ SQLite repositories and migrations
  │    └─ artifact store
  └─ Secure IPC for first-party renderer

Renderer (untrusted presentation)
  ├─ workspace/account/property selector
  ├─ browser view controls
  ├─ login and task health
  ├─ review queue / execution approval
  └─ Agent conversation and evidence display

RPA Worker (separate process)
  ├─ read/execute adapters per channel
  ├─ isolated execution browser/profile adapter
  └─ screenshots/traces/structured results

Agent Runtime (separate process)
  ├─ skills/workflows
  ├─ tool client only
  └─ no direct Electron, Cookie or database access

External/Cloud
  ├─ OTA/PMS source systems
  ├─ optional official channel adapters
  └─ optional team/cloud synchronization
```

### 边界原则

1. **Renderer 不拥有业务权威状态。** 它发 intent、收 snapshot，不直接决定账号上下文或执行权限。
2. **Main 不堆业务规则。** Main 负责可信编排与资源管理；纯订单/任务领域逻辑保持 Electron 无关。
3. **浏览器上下文与任务上下文统一。** 一个任务必须能追溯到 workspace/account/property/profile 以及开始时的登录健康状态。
4. **UI 浏览器和执行 worker 分工。** 用户可见 WebContentsView 负责登录、查看、验证码和低频接管；批量自动任务放在可超时、可重启的 worker。
5. **API 优先，浏览器补洞。** 有稳定官方 API 的渠道逐步迁入 adapter；RPA 结果仍归一到相同领域事件。
6. **Agent 只能通过工具行动。** 先结构化事实，再分析；高风险写操作必须审批并做执行后校验。

## 6. 推荐实施顺序

### 阶段 0：先修基础边界

目标：在继续扩展渠道前消除会话串用和任意导航。

1. 写 ADR，确定 `workspace/account/property/profile/tab` 术语和 ID 规则。
2. 在 main 建立 channel manifest 与导航策略。
3. 将 session 改为 per-account partition，并设计旧全局 profile 迁移。
4. 将 IPC 输入改为明确 schema；创建页签不再接收 renderer 给出的任意 URL。
5. 为双账号隔离、导航/popup 拒绝和 IPC 运行时校验补测试。

完成标准：两个同渠道账号可以同时登录且 Storage 不互通；任何未声明 origin 和本地网络目标默认被拒绝。

### 阶段 1：完成一个真实只读纵向闭环

目标：证明产品不是浏览器书签集合。

1. 建立 SQLite schema、migration、repository 和 artifact store。
2. 持久化 workspace/account/property/tab/login health/task run。
3. 接入一个渠道、一个账号、一个门店的只读采集任务。
4. 定义结构化结果、`observedAt`、source 和数据质量状态。
5. UI 展示真实任务状态、结果与失败证据。
6. Agent 只对这一份结构化结果生成解释，不执行写操作。

完成标准：应用重启可恢复上下文；采集失败可定位；Agent 展示的每个事实能追溯到数据和采集时间。

### 阶段 2：建立工具与审批体系

目标：让 Agent 能安全使用用户已登录的页面和任务能力。

1. 在 main 建立 transport-neutral ToolRegistry。
2. 先提供只读 browser/context/task 工具。
3. Agent runtime 独立进程，通过受控 bridge 或 MCP adapter 调用。
4. 加入超时、取消、输出限制、审计、敏感数据策略。
5. 再增加单项写操作，完整实现提案、确认、执行、校验和失败恢复。

完成标准：Agent 无法直接拿 Cookie、任意 URL、任意 evaluate、文件系统或数据库；每个写动作可审计、可拒绝、可验证。

### 阶段 3：建设订单与异常业务模型

目标：从“抓到一些数据”升级为可运营的订单变化中心。

建议最小事件：

```text
channel_order_created
channel_order_modified
channel_order_cancelled
inventory_conflict_detected
rate_inventory_mismatch_detected
manual_review_required
action_proposed
action_approved
action_executed
action_verified
action_failed
```

订单使用渠道订单号、账号、门店和事件版本做幂等；异常进入 review queue，不直接触发库存或价格写入。对高价值渠道逐步增加官方 API adapter，让 API 与 RPA 产生同一套标准事件。

## 7. 不建议现在照搬的部分

- 不需要立刻复制订单来了完整云 PMS、Channel Manager、财务、房务和多端体系。
- 不需要第一版就同时支持全部 OTA、多账号和跨店批量操作。
- 不需要把 MCP 当作所有内部模块的通信协议；进程内优先使用类型化接口，MCP 只作为 Agent 边界适配。
- 不需要让 UI 浏览器承担所有批量 RPA；它的首要职责是登录、查看和人工接管。
- 不应承诺 RPA 抓单能够实现“实时防超售”。没有官方渠道直连时，产品承诺应是巡检、异常发现、辅助处理和可验证的半自动执行。

## 8. 最终建议

当前项目不需要推倒重来。Electron/Svelte、main/preload/renderer 分层、安全 fuses、日志和测试基础都可以保留。

真正需要调整的是应用核心抽象：从 `channelId + tab + global session` 升级为 `workspace + account + property + profile + tab + execution context`，再在此基础上接入持久化、任务 worker 和受控工具层。

建议团队下一迭代只承诺两件事：

1. 完成 per-account session、channel manifest 和 workspace 状态权威重构。
2. 跑通一个渠道、一个账号、一个门店的只读任务闭环。

这两步完成后，再接 Agent 才能得到可解释、可审计、不会串账号的产品能力。否则 Agent 页面越早“接通”，后续返工越大。

## 9. 验证说明

本报告为静态架构评审，没有修改生产代码，也没有触发真实外部系统操作。评审期间检查了当前仓库状态、Node/npm 版本、源代码、测试代码和参考文档。评审环境实际为 Node `v26.3.0`、npm `11.16.0`；仓库要求 Node `>=24 <25`，因此后续运行正式仓库验证命令应先切换到 Node 24。
