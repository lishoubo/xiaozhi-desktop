# Electrobun 用于 RMS Desk 的可行性判断

调研日期：2026-07-29

## 结论

Electrobun 可以做 RMS Desk 的桌面壳、主 UI、托盘、轻量更新、多标签 WebView。但如果我们的核心目标是：

```text
内嵌 OTA/PMS 浏览器
多账号登录态隔离
长期监控价/量/态
自动识别页面变化
通过 browser_* 工具点击、输入、截图、网络监听
安全地执行价格/库存/状态调整
```

那我不建议把 Electrobun 作为第一版核心底座。更稳的选择仍然是 Electron + WebContentsView + CDP/Playwright/MCP。

更准确的推荐：

```text
RMS Desk 核心 Agent / RPA 浏览器：Electron 优先
轻量辅助工具、只读监控面板、报表桌面壳：Electrobun 可以考虑
独立后台采集/验证 worker：可以评估 Bun.WebView / Playwright
```

## Electrobun 是什么

Electrobun 是一个用 TypeScript 构建跨平台桌面应用的框架。它主打：

- 小包体：官方宣传约 14MB 级别。
- 快启动：官方宣传冷启动低于 50ms。
- 小更新：基于 BSDIFF/ZSTD 做很小的增量更新。
- 主进程跑 Bun/Cottontail。
- UI 用 Web 技术。
- 默认使用系统 WebView。
- 可选打包 CEF，换取 Chromium 一致性。
- 支持 `<electrobun-webview>`，用于嵌入隔离网页。
- 支持多标签浏览器模板。
- 支持 typed RPC，在 Bun 主进程和 WebView 间通信。

它的目标更像：

```text
更轻、更快、更小的 Electron 替代框架
```

但“能做桌面壳”和“适合做 OTA/PMS 自动化平台”是两回事。

## 对我们有利的点

### 1. 小包体和更新机制

我们如果要把 RMS Desk 发给大量商家，包体和更新体验很重要。Electrobun 的 ZSTD 自解压和 BSDIFF 小更新，对频繁升级渠道 skill/helper 很有吸引力。

不过，如果我们启用 `bundleCEF`，包体会增加 100MB+。这会削弱 Electrobun 最大优势。

### 2. TypeScript 全栈

主进程和 UI 都用 TypeScript，开发体验简单。我们可以用 React/Vite/Tailwind 做主界面，用 Bun 做本地服务、定时任务、SQLite/HTTP/MCP。

### 3. 多 WebView / OOPIF 思路

Electrobun 的 `<electrobun-webview>` 是 Out-Of-Process IFrame，目标是安全隔离和 DOM 集成。这个思路适合做：

- 多渠道页签
- 多账号页面
- Web 应用容器
- 类浏览器产品

### 4. CEF 可选

默认系统 WebView 在不同系统上行为不一致。Electrobun 支持 `bundleCEF` 和 `defaultRenderer: 'cef'`，这让它可以走 Chromium 路线。

但这也意味着：

```text
不用 CEF：控制面和行为一致性不足
用 CEF：包体接近 Electron，复杂度上升
```

## 关键风险

### 1. 浏览器自动化控制面不够明确

订单来了那类方案最关键的是：

```text
browser_snapshot
browser_click
browser_type
browser_listen_request
browser_take_screenshot
tab/account/session resolver
CDP frame-aware click
```

Electron 这里有成熟路径：

```text
webContents
webContents.debugger
session.fromPartition
session.webRequest
capturePage
WebContentsView
```

Electrobun 文档能看到 WebView、OOPIF、events、typed RPC、CEF flags，但没有看到同等成熟、统一、公开的：

- WebView 级 CDP session API
- frame-aware element resolver
- per-webview network interception
- cookie/session partition 管理 API
- DevTools Protocol 工具链
- accessibility tree/ref 自动化能力

如果这些要我们自己补，就会从“轻量框架”变成“我们维护一个浏览器自动化内核”。

### 2. 系统 WebView 不适合 OTA/PMS RPA

默认系统 WebView 是：

```text
macOS: WKWebView
Windows: Edge WebView2
Linux: WebKitGTK
```

这对普通 UI 好，但对 OTA/PMS 自动化不理想：

- DOM、网络、cookie、storage、调试能力平台差异大。
- 某些 OTA 后台对浏览器内核敏感。
- 价/量/态调整需要高可靠操作，不适合被平台差异拖累。
- CDP 不是所有后端都统一支持。

对我们这种业务，浏览器一致性比包体更重要。

### 3. 如果启用 CEF，优势被削弱

启用 CEF 可以获得 Chromium 一致性，但官方也说明会增加 100MB+ 包体。

这时 Electrobun 相比 Electron 的优势主要剩：

- Bun 主进程更轻。
- 更新机制可能更小。
- OOPIF 设计较新。

但我们仍要自研大量 Electron 已经成熟的浏览器控制和生态能力。

### 4. 生态成熟度风险

Electrobun 发展很快，但相对 Electron：

- 生态小很多。
- 生产案例少很多。
- 浏览器自动化案例少。
- 现成 MCP/browser-agent 集成少。
- 调试和排障资料少。

对于“后面要监控价量态调整”这种经营核心能力，框架成熟度很重要。

## 和 Bun.WebView 的区别

最近 Bun 自己也有 `Bun.WebView`，这和 Electrobun 不是一回事，但相关。

Bun.WebView 是 Bun runtime 里的 headless browser API，能：

- navigate
- evaluate
- click/type/press
- screenshot
- persistent storage
- Chrome backend 下 raw CDP

它适合做：

```text
后台采集 worker
自动化验证 worker
独立 RPA worker
页面截图/探测
```

但它不是桌面内嵌可视浏览器框架。它更像 Playwright/Puppeteer 的轻量替代。

所以可行组合是：

```text
Electrobun 做桌面 UI
Bun.WebView 或 Playwright 做后台监控/采集
```

但如果我们需要用户和 Agent 共享同一个可见 OTA/PMS 页面，这个组合会变复杂：后台 WebView 的登录态、前台 WebView 的登录态、用户确认动作、页面可见性都要同步。

## 对“价量态调整”的影响

价量态可以理解为：

- 价格：房价、促销价、渠道价、会员价。
- 量：库存、可售房量、保留房、超售风险。
- 态：开关售、房态、订单状态、渠道上下架、限制规则。

这类能力有两个层次。

### 只读监控

只读监控可以通过多种方式实现：

- PMS/OTA API。
- 页面网络请求监听。
- 定时打开页面抓取。
- 后台 Playwright/Bun.WebView。
- 数据库/报表接口。

这部分 Electrobun 可以承载，因为它主要是本地任务和展示。

### 写入调整

写入调整风险高，需要：

- 明确目标渠道/账号/门店。
- 明确调整前后值。
- 页面或接口二次确认。
- 操作日志。
- 幂等保护。
- 回滚/补偿。
- 用户确认。
- 防止模型猜 URL、乱点、乱发 HTTP。

这部分最需要稳定的 browser control 和权限层。Electron/CDP/Playwright 生态更稳。

## 方案对比

| 维度 | Electron | Electrobun |
|---|---:|---:|
| 桌面 UI | 成熟 | 可以 |
| 包体 | 大 | 小，启用 CEF 后变大 |
| 更新 | 成熟但包大 | 小更新有优势 |
| 内嵌浏览器 | WebContentsView 成熟 | WebView/OOPIF 有潜力 |
| Chromium 一致性 | 默认有 | 需 bundleCEF |
| CDP 控制 | 成熟，webContents.debugger | 文档层面不够明确 |
| 网络监听 | session.webRequest 成熟 | 文档层面不够明确 |
| 多账号 partition | session.fromPartition 成熟 | 需要验证/自研 |
| Playwright/CDP 生态 | 强 | 弱 |
| MCP/browser agent 集成 | 更容易 | 需要自研更多 |
| 价量态写操作可靠性 | 更稳 | 风险较高 |
| 长期维护风险 | 低 | 中高 |

## 推荐架构

### 推荐 1：主线仍用 Electron

```text
Electron
  WebContentsView
  session.fromPartition
  webContents.debugger / CDP
  session.webRequest
  MCP browser_* tools
  skill/plugin market
  PMS/OTA policy layer
```

这是最接近订单来了方案，也最适合价量态调整。

### 推荐 2：Electrobun 做旁路原型

可以用 Electrobun 做一个小原型验证：

- 多标签 WebView。
- 登录一个 OTA 页面。
- 是否能持久 cookie。
- 是否能隔离多个账号。
- 是否能监听导航和网络。
- 是否能从主进程控制嵌入页点击/输入。
- CEF 模式下是否有可用 CDP。

验证通过前，不要把它定为主底座。

### 推荐 3：后台监控 worker 可独立选型

价量态监控不一定要和桌面壳绑定。可以拆成：

```text
Desktop shell:
  Electron or Electrobun

Monitoring worker:
  Playwright / Bun.WebView / API adapter

Write executor:
  Electron visible browser + policy confirmation
```

这样只读监控可以轻量化，写入调整仍走可见、可审计、可确认的通道。

## 最终建议

不要因为 Electrobun 轻，就直接替换 Electron。

对于我们的目标，判断标准应该是：

```text
能否稳定复用 OTA/PMS 登录态？
能否多账号隔离？
能否有统一 Chromium 行为？
能否拿到 CDP / network / screenshot / accessibility tree？
能否形成 browser_snapshot -> ref -> click/type 的工具链？
能否对价量态写操作做强权限和审计？
```

目前看，Electrobun 在“桌面壳”上很好，在“经营级浏览器自动化平台”上证据不足。

所以建议：

```text
主产品底座：Electron
后台只读采集：可评估 Bun.WebView / Playwright
Electrobun：保留为轻量壳或实验分支，不作为第一版核心技术路线
```

## 参考来源

- Electrobun GitHub：https://github.com/blackboardsh/electrobun
- Electrobun What is Electrobun：https://blackboard.sh/electrobun/docs/guides/what-is-electrobun/
- Electrobun Webview Tag Architecture：https://blackboard.sh/electrobun/docs/guides/architecture/webview-tag/
- Electrobun Build Configuration：https://framework.blackboard.sh/electrobun/apis/cli/build-configuration/
- Electrobun Events：https://framework.blackboard.sh/electrobun/apis/events/
- Bun WebView：https://bun.com/docs/runtime/webview

