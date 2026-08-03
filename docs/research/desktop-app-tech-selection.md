# RMS Desktop App 技术选型

## 背景

目标是实现一个支持 Windows、macOS 的桌面应用，后续可能扩展到 Linux 等其他桌面系统。核心能力包括：

- 内置爬虫/RPA，用于登录 OTA 平台、爬取经营数据、订单、价格、库存等信息。
- 内置 AI Agent，用于对爬取后的结构化数据做分析、归因和建议。
- 内置浏览器，用于用户登录、人工接管、验证码处理、页面查看和调试。

现有参考项目 `/Users/lishoubo/p/projects/xiaozhi-rms-workspace` 的主要形态是：

- `rms-admin`: React/Vite/Ant Design 管理端。
- `rms-server`: Java Spring Boot 服务端。
- `rms-data`: 数据分析与报表模块。
- `rms-rpa-worker`: Python RPA worker，当前依赖 DrissionPage，并已有 OTA 自动化、登录、订单、房态、价格等相关能力。

因此桌面版不宜重写全部能力，优先考虑复用现有 Web UI 和 Python RPA 资产。

## 结论

推荐第一版采用：

```text
Electron + React/Vite + Python RPA sidecar + SQLite + 本地 Agent 编排
```

不建议第一版选择 Tauri、Flutter Desktop、Qt/CEF 作为主框架。

核心理由：

- 桌面端需要强内置浏览器能力，Electron 自带 Chromium，跨 Windows/macOS 行为更一致。
- 现有前端是 React/Vite，Electron 可以低成本复用。
- 现有爬虫是 Python RPA worker，可作为 sidecar 进程接入 Electron。
- AI Agent、本地任务调度、日志、文件、密钥、浏览器 profile 管理都适合由 Electron 主进程统一编排。
- 对这个产品来说，浏览器一致性和自动化能力优先级高于安装包体积。

## 跨端框架选型

| 方案 | 结论 | 说明 |
| --- | --- | --- |
| Electron | 推荐 | 最适合内置浏览器、RPA、React UI、本地进程编排的组合场景 |
| Tauri | 可选但不推荐第一版 | 体积小、安全模型好，但依赖系统 WebView，浏览器行为一致性弱 |
| Flutter Desktop | 不推荐 | UI 能力强，但内置真实浏览器和自动化链路不顺 |
| Qt + CEF | 不推荐第一版 | 浏览器能力强，但工程复杂度、构建、分发、维护成本高 |
| .NET MAUI / WPF | 不推荐 | Windows 体验较好，但 macOS 和后续跨端路线不占优 |

### Electron

优势：

- 自带 Chromium 和 Node.js，一套代码支持 Windows、macOS、Linux。
- 可以直接复用 React/Vite 前端。
- 内置浏览器能力成熟，适合做多页签、登录态、下载、权限控制、DevTools 调试。
- 主进程适合管理 Python/Java/Node sidecar、任务队列、日志、托盘、自动更新。
- 与 Playwright、Chromium、Chrome DevTools Protocol 生态匹配。

劣势：

- 安装包和运行内存较大。
- 安全边界需要认真设计，尤其是加载第三方 OTA 后台页面时。
- macOS 签名、公证、Windows 代码签名、自动更新需要提前规划。

适合本项目的原因：

- 项目核心不是普通 CRUD 桌面壳，而是浏览器自动化、登录态管理、人工接管和数据分析。
- 统一 Chromium 内核比小安装包更重要。

### Tauri

优势：

- 安装包小。
- Rust 后端安全、性能和系统集成能力好。
- 使用系统 WebView，适合普通 Web UI 桌面壳。

劣势：

- Windows 使用 WebView2，macOS 使用 WKWebView，Linux 使用 WebKitGTK，浏览器行为不完全一致。
- 对复杂浏览器自动化、调试、profile 复用、DevTools 协议控制不如 Electron 顺。
- 现有 Python RPA 和 React UI 可以接，但整体编排收益不如 Electron 明显。

适合场景：

- 主要是本地工具、管理端壳、轻量客户端。
- 不强依赖浏览器自动化一致性。

本项目不建议第一版选择 Tauri。

### Flutter Desktop

优势：

- UI 跨端能力强。
- 动画和原生风格体验较好。

劣势：

- WebView、自动化、Cookie/profile 管理不是核心强项。
- 现有 React/Vite 前端难以复用。
- 要把现有管理端重写成 Flutter，成本较高。

本项目不建议。

### Qt + CEF

优势：

- CEF 可以深度嵌入 Chromium。
- 对浏览器内核控制能力强。

劣势：

- C++/Qt/CEF 构建和分发复杂。
- macOS/Windows 包结构、helper 进程、签名、公证、升级链路都更重。
- 对团队效率不友好。

除非未来需要深度定制浏览器内核，否则不建议作为第一版。

## 内置浏览器实现

建议区分两类浏览器，不要混用：

```text
用户可见浏览器：Electron WebContentsView
爬虫执行浏览器：Python RPA worker / Playwright / DrissionPage 独立进程
```

内嵌浏览器的详细实现、与 Chrome 的差异、Cookie/profile 保存、反爬风险和监听用户操作方案，见 [embedded-browser-design.md](embedded-browser-design.md)。

### 用户可见浏览器

用途：

- OTA 平台登录。
- 短信、验证码、人机校验处理。
- 用户人工接管。
- 展示目标网页。
- 调试登录态、Cookie、页面状态。

实现建议：

- Electron 主窗口承载 React UI。
- 浏览器区域优先使用 `WebContentsView`。
- 不优先使用 `<webview>`，除非后续验证 `WebContentsView` 无法满足某个具体交互需求。
- 每个 OTA 平台、酒店、账号使用独立 session partition。
- profile、cookie、localStorage 与业务账号绑定。
- 支持打开 DevTools、截图、重新登录、清空会话、导出诊断信息。

安全要求：

```ts
webPreferences: {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true
}
```

还需要：

- 默认拒绝远程页面访问 Node/Electron API。
- 通过 preload 只暴露极少量受控 API。
- 限制导航范围。
- 拦截新窗口。
- 控制下载目录。
- 使用权限白名单处理剪贴板、定位、摄像头、通知等能力。
- 不允许远程网页直接发起本地敏感操作。

### 爬虫执行浏览器

用途：

- 自动登录检测。
- 数据抓取。
- 页面操作。
- 失败截图、trace、HTML 快照。
- 定时任务和批量任务执行。

推荐短期方案：

- 复用现有 `rms-rpa-worker`。
- Electron 主进程启动 Python sidecar。
- 通过本地 HTTP、stdio、WebSocket 或消息队列通信。
- 每个任务传入账号、酒店、平台、profile、任务参数。

中期方案：

- 逐步评估将部分 RPA 迁移到 Playwright。
- 对需要强浏览器一致性的任务优先使用 Playwright Chromium。
- 对已有稳定 DrissionPage 任务先保留，减少迁移风险。

不建议：

- 直接让 UI 内置浏览器承担所有爬虫执行。

原因：

- UI 浏览器需要保持响应。
- RPA 失败和重启不能影响主窗口。
- 自动化需要独立超时、重试、并发、代理、profile 和诊断数据。
- worker 独立后更容易未来扩展到远程执行节点。

## 推荐架构

```text
rms-desk-app
├─ desktop-shell
│  ├─ Electron main process
│  ├─ window/session/profile management
│  ├─ sidecar process manager
│  ├─ updater
│  └─ secure IPC
├─ web-ui
│  └─ React/Vite/Ant Design
├─ local-api
│  ├─ local HTTP/WebSocket API
│  ├─ task orchestration
│  └─ auth/config/log APIs
├─ rpa-worker
│  ├─ Python DrissionPage/Playwright tasks
│  ├─ browser profile adapter
│  └─ task diagnostics
├─ agent-runtime
│  ├─ LLM provider adapter
│  ├─ tool calling
│  ├─ analysis workflows
│  └─ human approval gates
├─ storage
│  ├─ SQLite
│  ├─ optional DuckDB
│  └─ file artifact store
└─ packaging
   ├─ Windows installer
   ├─ macOS dmg/pkg
   └─ auto update
```

### 进程模型

```text
Electron Main
  ├─ Renderer: React App
  ├─ WebContentsView: OTA Browser
  ├─ Local API Process
  ├─ Python RPA Worker Process
  └─ Agent Worker Process
```

主进程职责：

- 生命周期管理。
- 窗口管理。
- 浏览器 session 管理。
- sidecar 进程启动、停止、健康检查。
- IPC 权限边界。
- 日志、更新、崩溃上报。

Renderer 职责：

- UI 展示。
- 任务发起。
- 状态查看。
- 人工接管入口。
- Agent 分析结果展示。

RPA Worker 职责：

- 登录态校验。
- 数据爬取。
- 页面自动化操作。
- 失败诊断材料采集。

Agent Runtime 职责：

- 读取结构化数据。
- 做分析和建议。
- 生成可解释结论。
- 对高风险动作要求人工确认。

## 数据与存储

第一版建议：

| 数据类型 | 存储 |
| --- | --- |
| 配置 | SQLite |
| 酒店/账号/平台关系 | SQLite |
| 任务记录 | SQLite |
| 爬取结果 | SQLite，数据量大时分表 |
| 分析型数据 | 可选 DuckDB |
| 截图/trace/html 快照 | 本地文件目录 |
| 密钥/token | OS keychain，必要时加密后落盘 |
| 浏览器 profile | Electron/worker 独立 profile 目录 |

不要第一版强依赖 Redis/MySQL。

原因：

- 桌面应用要尽量安装即用。
- Redis/MySQL 会显著增加用户环境复杂度。
- 本地 SQLite 足够支撑任务记录、配置、轻量分析。
- 后续多端同步或团队版再引入远程服务。

## AI Agent 设计

建议不要让 Agent 直接分析网页 DOM 或未清洗原始数据。

推荐链路：

```text
RPA 爬取
  → 结构化入库
  → 数据质量校验
  → 指标计算
  → Agent 分析
  → 生成建议
  → 人工确认
  → 执行动作
```

Agent 输出建议拆成：

- 事实：基于哪些数据。
- 判断：识别出什么问题。
- 原因：可能的业务原因。
- 建议：调价、补库存、检查促销、检查曝光等。
- 操作：是否需要发起 RPA 任务。
- 风险：可能带来的收益和副作用。

高风险动作必须人工确认：

- 批量改价。
- 批量改库存。
- 修改促销。
- 登录态迁移。
- 删除本地数据。

## 与现有系统的复用策略

短期：

- 复用 `rms-admin` 的 React 页面和组件。
- 复用 `rms-rpa-worker` 的 Python RPA 能力。
- 服务端 Java 逻辑不整体打包进桌面版，优先抽取必要 API/领域逻辑。
- 本地版先用 SQLite 替代 MySQL。
- 本地任务队列替代 Redis stream。

中期：

- 将通用任务模型、OTA 适配器、数据协议沉淀成共享 contract。
- 让桌面 worker 和服务器 worker 使用相同 payload schema。
- 支持本地任务和远程任务统一调度。
- 根据稳定性逐步迁移部分 RPA 到 Playwright。

长期：

- 支持云端同步。
- 支持远程 worker。
- 支持团队多账号、多酒店协作。
- 支持插件化 OTA 平台适配。

## 浏览器请求、HTTP 请求与 Playwright 能力边界

很多 OTA 爬虫看起来是在“打开浏览器后发起请求”。这和普通 `curl` / `requests` 的核心区别是：浏览器不是只发 HTTP，它还带着真实网页运行环境。

```text
curl / requests = 手工拼一次 HTTP 请求
浏览器 = 页面 JS 在真实登录态和真实运行环境里自然发请求
```

### 浏览器发请求和 curl 的区别

| 维度 | 浏览器发请求 | curl / requests 发请求 |
| --- | --- | --- |
| Cookie | 自动使用当前站点 Cookie | 需要自己复制、维护、刷新 |
| localStorage/sessionStorage | 页面 JS 可读写 | 默认没有 |
| JS 执行 | 会执行页面脚本 | 不会执行页面脚本 |
| 动态参数 | 页面自动生成 token、sign、nonce | 需要自己逆向或模拟 |
| 登录态 | 与真实用户会话一致 | 需要手工维护会话 |
| 请求顺序 | 页面自然触发 | 需要自己还原流程 |
| Header | 浏览器自动带 Sec-Fetch、Origin、Referer 等上下文 | 需要自己补齐 |
| CORS | 受浏览器 CORS 限制 | 不受浏览器 CORS 限制 |
| 风控表现 | 更像真实用户环境 | 更容易暴露脚本特征 |
| 性能 | 慢、重 | 快、轻 |
| 适合场景 | 登录、验证码、复杂页面状态、强风控 | 稳定接口、批量数据抓取、重试和并发 |

很多后台接口表面上只是：

```http
GET /api/orders?date=2026-07-28
```

但真实调用可能依赖：

- session cookie。
- CSRF token。
- localStorage token。
- 当前选择的酒店、公司、门店上下文。
- 前端 JS 生成的签名。
- 时间戳和 nonce。
- Referer、Origin、Sec-Fetch 系列 header。
- 初始化接口返回的临时 token。
- 页面访问顺序。
- 设备指纹或人机校验状态。

浏览器方案的价值不是“会点页面”，而是先用浏览器建立这些上下文，再复用上下文完成数据抓取。

### 推荐抓取模式

本项目推荐混合模式：

```text
登录和上下文建立：浏览器
数据抓取：优先 HTTP/API 请求
复杂操作：浏览器自动化
失败兜底：人工接管内置浏览器
```

也可以概括为：

```text
Browser for session
HTTP for data
Browser automation for hard actions
```

这样可以兼顾稳定性和效率：

- 浏览器解决登录、验证码、JS token、上下文、风控。
- HTTP 请求负责批量抓数据，速度更快、并发更好、重试更容易。
- 浏览器自动化只用于必须依赖页面状态的操作，例如改价、选择门店、处理弹窗等。

### Playwright 能不能做到混合抓取

可以。Playwright 并不弱，它可以做到“浏览器登录 + 复用登录态发 HTTP 请求”。只是它的默认心智更偏浏览器自动化和测试框架，不像 DrissionPage 那样把“浏览器模式 + requests 模式”做成一个很直观的爬虫式体验。

Playwright 可以通过以下方式实现混合抓取：

1. 使用浏览器页面完成登录。
2. 保存 `storageState`，包含 cookie 和 localStorage。
3. 创建 `APIRequestContext`，复用同一份登录态发 HTTP 请求。
4. 或者在页面上下文里执行 `fetch`，让请求天然带上浏览器当前环境。
5. 对复杂页面继续使用 locator、点击、输入、等待、截图、trace。

示意：

```ts
const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

await page.goto("https://partner.example.com/login");
// 用户或自动化完成登录

const state = await context.storageState();

const api = await request.newContext({
  baseURL: "https://partner.example.com",
  storageState: state,
});

const res = await api.get("/api/orders?date=2026-07-28");
const data = await res.json();
```

也可以直接在页面内请求：

```ts
const data = await page.evaluate(async () => {
  const res = await fetch("/api/orders?date=2026-07-28");
  return await res.json();
});
```

这两种方式的差别：

| 方式 | 特点 |
| --- | --- |
| `APIRequestContext` | 更像 HTTP client，适合批量接口抓取、重试、并发、结构化测试 |
| `page.evaluate(fetch)` | 完全处在页面 JS 环境里，能自然使用页面已有的 JS 变量和上下文，但调试和封装要更谨慎 |

### DrissionPage 与 Playwright 在混合抓取上的差异

| 维度 | DrissionPage | Playwright |
| --- | --- | --- |
| 混合抓取体验 | 原生心智就是浏览器 + requests 混合 | 可以做到，但需要自己组织 `storageState` / `APIRequestContext` |
| Python 爬虫上手 | 更顺手 | 稍偏工程化 |
| 浏览器一致性 | 主要依赖 Chrome/Chromium | 官方维护 Chromium/Firefox/WebKit |
| 诊断能力 | 可用但偏轻 | trace、video、screenshot、network 更完整 |
| 长期产品化 | 依赖自研封装 | 更适合标准化、跨平台、可诊断的 RPA 引擎 |
| 现有项目迁移成本 | 当前最低 | 需要逐步迁移 |

因此前面的建议不是说 Playwright 做不到混合抓取，而是：

- 短期复用 DrissionPage，是因为现有项目已经有大量 Python RPA 资产。
- 中期收敛到 Playwright，是因为桌面产品化后更需要标准化诊断、浏览器版本管理、自动等待、trace 和跨平台一致性。

### 标准化浏览器自动化是什么意思

这里说 Playwright 更偏“标准化浏览器自动化”，不是说它更会爬数据，也不是说它更省资源，而是说它更像一个可复制、可诊断、可回归的浏览器控制框架。

具体含义：

| 能力 | Playwright 的特点 |
| --- | --- |
| 浏览器版本 | 可以由 Playwright 管理固定版本，减少不同机器浏览器版本不一致的问题 |
| 等待机制 | 自动等待元素可见、可点击、稳定，减少手写 `sleep` |
| 定位模型 | `locator` 模型更规范，适合长期维护复杂页面流程 |
| 诊断材料 | 支持 trace、截图、video、network 等完整诊断材料 |
| 任务隔离 | browser、context、page 模型清楚，适合多账号、多任务隔离 |
| 跨浏览器 | 支持 Chromium、Firefox、WebKit |
| 回归测试 | RPA 流程可以比较自然地沉淀成自动化回归测试 |

例如“点击一个按钮”，Playwright 不只是直接发 click，它会先判断元素是否存在、是否可见、是否可用、位置是否稳定，再执行点击。失败时还可以留下 trace，后续能回放看到失败发生在哪一步。

这对桌面产品化很重要，因为用户机器环境不可控。长期会遇到的问题不是“脚本在开发机能不能跑”，而是：

- 用户说任务失败了，如何知道失败在哪一步。
- Windows 和 macOS 行为不一致，如何复现。
- 页面元素偶发点不到，如何排查。
- 一个版本升级后多个 OTA 任务坏了，如何做回归。
- 多个账号、多家酒店的浏览器上下文如何隔离。

Playwright 的优势主要体现在这些工程问题上。

### Playwright 是否更节省资源

通常不是。不能把迁移 Playwright 理解成省资源方案。

更准确的判断：

| 场景 | 资源判断 |
| --- | --- |
| 纯 HTTP 抓接口 | `requests` / `httpx` 最省资源 |
| 浏览器登录后转 HTTP 抓取 | DrissionPage 通常更轻、更顺手 |
| 长时间完整浏览器自动化 | 两者都重，主要资源消耗来自 Chromium |
| 多账号并发跑浏览器 | 两者都不省，关键是 browser/context/profile 设计 |
| 需要 trace/video/完整诊断 | Playwright 更重，但更容易排查问题 |
| headless Chromium 单任务 | 差距不一定大，取决于页面和启动方式 |

浏览器自动化的主要资源消耗来自：

```text
Chromium 进程
页面 JS
渲染进程
网络资源
图片/字体/视频
profile/cache
并发页面数
```

不是 DrissionPage 或 Playwright 这个库本身。

如果目标是省资源，正确方向是：

- 浏览器只负责登录和困难操作。
- 数据抓取尽量走 HTTP 接口。
- 减少并发浏览器数量。
- 复用 browser/context。
- 禁用图片、视频、字体等无关资源。
- 任务跑完及时关闭 page/context。
- 对稳定接口建立纯 HTTP 抓取路径。

因此，本项目的策略应该是：

```text
短期为了复用和效率：继续 DrissionPage
中期为了产品化质量：逐步引入 Playwright
省资源目标：靠架构分层和 HTTP 化，而不是靠 Playwright 替换 DrissionPage
```

### 实际选型建议

短期：

- 已经稳定的 DrissionPage 任务继续保留。
- 新桌面壳通过 sidecar 方式调用现有 Python worker。
- 优先把登录态、profile、任务输入输出协议标准化。

中期：

- 新增 RPA 任务优先评估 Playwright。
- 高频、易坏、需要强诊断的任务迁移到 Playwright。
- 保留少量适合接口混合抓取、且已稳定运行的 DrissionPage 任务。

长期：

- 将 RPA 任务抽象为统一接口。
- 底层可以是 DrissionPage、Playwright 或纯 HTTP。
- 上层任务调度、数据入库、Agent 分析不关心底层实现。

## 分发与运维

必须提前考虑：

- Windows 代码签名。
- macOS Developer ID 签名和 notarization。
- 自动更新。
- Python runtime 打包。
- Playwright/Chromium/DrissionPage 浏览器依赖打包。
- 本地数据目录迁移。
- 崩溃日志。
- RPA 任务日志。
- 用户可导出的诊断包。
- 版本升级中的数据库 migration。
- 卸载时是否保留用户数据。

建议目录：

```text
userData/
├─ config/
├─ db/
├─ profiles/
│  ├─ electron/
│  └─ rpa/
├─ logs/
├─ artifacts/
│  ├─ screenshots/
│  ├─ traces/
│  └─ html/
└─ cache/
```

## 安全与风控

### Electron 安全

必须遵守：

- 远程页面禁用 Node integration。
- 开启 contextIsolation。
- 开启 sandbox。
- 不关闭 webSecurity。
- IPC 白名单。
- 校验 IPC sender。
- 限制导航和新窗口。
- 不向远程页面暴露敏感 API。
- 本地 API 只监听 `127.0.0.1`。
- 本地 API 增加随机 token 或 session key。

### RPA 风控

需要设计：

- 登录失败熔断。
- 验证码人工接管。
- 操作频率限制。
- 随机等待。
- 任务重试上限。
- 账号级并发限制。
- 代理/IP 策略。
- 账号异常状态标记。
- 操作审计日志。

### 数据安全

需要设计：

- Cookie 加密存储。
- API key 使用系统 keychain。
- 日志脱敏。
- 诊断包脱敏。
- 本地数据库备份和恢复。
- 删除数据二次确认。

## 第一阶段落地建议

### MVP 范围

第一阶段只做最小闭环：

1. Electron 主壳。
2. 复用 React/Vite 页面。
3. 内置 OTA 浏览器。
4. 支持一个平台账号登录和 profile 保存。
5. Electron 启动 Python RPA worker。
6. 执行一个爬取任务。
7. 爬取结果写入 SQLite。
8. UI 展示任务状态、日志、截图。
9. Agent 针对爬取结果生成一份分析报告。

### 不建议第一阶段做

- 多平台完整适配。
- 云同步。
- 团队权限。
- 复杂自动更新策略。
- Redis/MySQL 本地部署。
- 完整 Java 服务端内嵌。
- Agent 自动执行高风险改价。

## 参考资料

- Electron 官方介绍：https://www.electronjs.org/docs/latest/
- Electron 安全指南：https://www.electronjs.org/docs/latest/tutorial/security
- Tauri 架构：https://v2.tauri.app/concept/architecture/
- Tauri 先决条件：https://v2.tauri.app/start/prerequisites/
- Playwright 浏览器支持：https://playwright.dev/docs/browsers
- Microsoft WebView2：https://learn.microsoft.com/en-us/microsoft-edge/webview2/
- Chromium Embedded Framework：https://chromiumembedded.github.io/cef/
