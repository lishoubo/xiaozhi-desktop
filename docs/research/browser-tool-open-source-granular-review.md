# browser_* 底层工具开源可用性分析

调研日期：2026-07-29

## 结论

订单来了的 `browser_*` 不太可能全部从零写。它的形态明显站在几类成熟开源/开放技术之上：

- MCP 协议层：可直接用 `@modelcontextprotocol/sdk`。
- Browser Agent 工具设计：与 `@playwright/mcp` 的工具名、snapshot/ref 模型高度相似。
- 浏览器控制：底层是 Electron `webContents` + Chrome DevTools Protocol。
- 网络、截图、输入事件：可以复用 Chrome/Electron/Playwright/Puppeteer 生态的成熟模式。

但它最关键的“内嵌 OTA/PMS 多账号浏览器”部分，应该不是某个开源项目可以直接拿来用的完整成品。原因是它需要绑定自己的 workspace/account/tab、Electron partition、PMS 登录上下文、业务权限策略和 skill 编排。

所以判断是：

```text
开源能直接用 60%：MCP server、普通 browser tools、snapshot/ref、CDP 操作、网络/截图。
必须自研 40%：Electron 内嵌页签管理、多账号 session partition、业务上下文、bridge、权限策略、PMS/OTA 工具。
```

## 1. 最像订单来了 browser_* 的开源项目：Playwright MCP

地址：

- https://github.com/microsoft/playwright-mcp
- https://playwright.dev/mcp/introduction
- https://playwright.dev/mcp/snapshots
- https://playwright.dev/mcp/capabilities

许可证：

- Apache-2.0

它能直接提供：

- MCP server。
- `browser_snapshot`。
- `browser_click`。
- `browser_type`。
- `browser_hover`。
- `browser_select_option`。
- `browser_press_key`。
- `browser_take_screenshot`。
- `browser_evaluate`。
- `browser_network_requests`。
- `browser_tabs`。
- accessibility snapshot。
- ref 驱动交互。
- headed browser 持久会话。

与订单来了的相似点：

```text
Playwright MCP:
  browser_snapshot -> accessibility tree -> [ref=e5] -> browser_click/browser_type

订单来了:
  browser_snapshot -> 可访问性文本快照 -> [ref=e12] -> browser_click/browser_type
```

Playwright 官方文档明确说明：Playwright MCP 使用 accessibility snapshot，而不是截图；每个可交互元素会带 ref，后续工具用 ref 点击/输入。这个思路和订单来了几乎一致。

能不能直接用？

```text
如果我们接受“外部 Playwright 浏览器”：可以直接用。
如果要控制 Electron 内嵌 WebContentsView：不能完整直接用，需要改造或重写适配层。
```

原因：

- Playwright MCP 默认控制 Playwright 启动/连接的浏览器 page。
- 订单来了控制的是 Electron 主进程里的内嵌 WebContents。
- 订单来了还有 workspace/account/tab/partition 这些业务维度，Playwright MCP 没有。

推荐用法：

```text
第一阶段：直接接入 @playwright/mcp，验证工具语义、Agent loop、snapshot/ref 工作流。
第二阶段：保留 Playwright MCP 的工具 schema 思路，自研 Electron WebContents adapter。
```

## 2. 最像“CDP 调试/后台 daemon”的项目：Chrome DevTools MCP

地址：

- https://github.com/ChromeDevTools/chrome-devtools-mcp
- https://www.npmjs.com/package/chrome-devtools-mcp
- https://developer.chrome.com/blog/chrome-devtools-mcp

许可证：

- Apache-2.0

它能直接提供：

- MCP server。
- 控制 live Chrome。
- 连接已有 Chrome debugging endpoint。
- 页面列表、导航、点击、输入、截图。
- 网络请求、console message。
- Performance/Lighthouse/heap snapshot 等 DevTools 能力。
- CLI。
- 后台 daemon。

特别值得注意：

Chrome DevTools MCP 的 CLI 文档说，它的 CLI 会作为 client 连接后台 daemon；Linux/macOS 用 Unix socket，Windows 用 named pipe。这个和订单来了 `browser-mcp-server -> bridge.sock -> Electron main` 的形态很像。

能不能直接用？

```text
如果目标是“控制外部 Chrome”：可以直接用。
如果目标是“控制我们的 Electron 内嵌 OTA/PMS 页签”：不能直接拿来完整使用，但它是很好的 CDP/MCP/daemon 参考。
```

优势：

- DevTools 能力很强，适合调试页面、网络、性能。
- 官方 ChromeDevTools 项目，维护活跃。
- 能连接已有 browser url / websocket endpoint。

限制：

- 官方说明主要支持 Google Chrome / Chrome for Testing。
- 它暴露浏览器内容给 MCP client，敏感数据场景必须自己加权限策略。
- 它不是按业务 workspace/account/session partition 设计的。

适合参考：

- daemon/socket 生命周期。
- MCP 工具拆分。
- 网络/console/performance/debug 工具。
- 连接已有浏览器实例的方式。

## 3. Browser-use：Agent 层可参考，不是内嵌浏览器底座

地址：

- https://github.com/browser-use/browser-use

许可证：

- MIT

它能提供：

- Python browser agent。
- 通过 Chromium/CDP 操作页面。
- 任务级自动化：打开网页、点击、输入、填表、提取数据。
- 自定义 tools。
- 新版本有 Python API -> Rust core -> browser harness 的形态。

能不能直接用？

```text
适合做独立 RPA agent / 后台 worker。
不适合作为 Electron 内嵌多账号浏览器的直接底座。
```

优势：

- 社区大，Agent 任务完成能力强。
- Python 集成成本低。
- 可以快速验证“给任务，让 agent 自己跑页面”的效果。

限制：

- 更偏 autonomous web task，不是业务内嵌浏览器工具协议。
- 多账号 OTA session partition、用户可见页签、PMS 上下文，需要我们自己接。
- 生产里遇到登录、验证码、风控，仍然要单独设计。

适合参考：

- Agent recovery loop。
- 自定义 tools 注入。
- 任务历史和最终结果结构。
- 浏览器 profile 管理。

## 4. Stagehand：自然语言浏览器操作层，可参考但不替代底座

地址：

- https://github.com/browserbase/stagehand
- https://github.com/browserbase/stagehand-python
- https://www.stagehand.dev/

许可证：

- MIT

它能提供：

- `act`：按自然语言执行动作。
- `extract`：结构化提取。
- `observe`：观察页面可执行动作。
- `agent`：多步浏览器任务。
- 本地 Chromium 或 Browserbase cloud browser。

能不能直接用？

```text
适合快速做“自然语言操作网页”的原型。
不适合直接覆盖订单来了这类细粒度 browser_* MCP 工具。
```

优势：

- API 设计好，适合把 AI 和确定性代码混用。
- 有 action caching / self-healing 思路。
- TypeScript/Python 都有。

限制：

- 抽象层比 `browser_click(ref)` 更高。
- 内嵌 Electron WebContents、多账号 session、业务权限仍要自研。
- 如果我们要做可审计、低风险、细颗粒工具，不能完全依赖自然语言 action。

适合参考：

- `observe -> act -> extract` 的产品 API。
- 自愈与动作缓存思路。
- 将 AI 探索转成可复用流程的模式。

## 5. Electron / CDP：订单来了真正控制内嵌浏览器的底层

地址：

- https://www.electronjs.org/docs/latest/api/web-contents
- https://www.electronjs.org/docs/latest/api/session
- https://www.electronjs.org/docs/latest/api/browser-view

可直接用的官方能力：

- `webContents` 渲染和控制页面。
- `webContents.debugger` 调 Chrome DevTools Protocol。
- `session.fromPartition(partition)` 创建/复用隔离 session。
- `webContents.session.webRequest` 监听网络。
- `capturePage` / CDP screenshot 截图。
- `BrowserView` / `WebContentsView` 内嵌页面。Electron 29 起 `BrowserView` 已废弃，推荐 `WebContentsView`。

订单来了这里大概率是自研的部分：

- workspace/account/tab 数据模型。
- 每个账号一个 partition。
- tab target resolver。
- snapshot ref map。
- ref -> frame -> element rect -> click point。
- MCP bridge 到主进程。
- PMS/OTA 业务权限。

这层没有一个开源库可以完整替代，但 API 都是公开的。

## 6. MCP SDK：可以直接用

地址：

- https://github.com/modelcontextprotocol/typescript-sdk

可直接用：

- `Server`
- `StdioServerTransport`
- `ListToolsRequestSchema`
- `CallToolRequestSchema`
- JSON-RPC MCP 协议处理

订单来了本地包里看到的 MCP server 形态就是这个模式：

```text
new Server(...)
server.setRequestHandler(ListToolsRequestSchema, ...)
server.setRequestHandler(CallToolRequestSchema, ...)
new StdioServerTransport()
server.connect(transport)
```

这层完全没必要自研。

## 细粒度组件拆分

| 组件 | 能直接用的开源 | 能否直接用 | 说明 |
|---|---|---:|---|
| MCP stdio server | `@modelcontextprotocol/sdk` | 是 | 标准协议层 |
| browser tool schema | `@playwright/mcp` | 大部分可用 | 工具名和行为可以参考/兼容 |
| accessibility snapshot/ref | `@playwright/mcp` | 外部浏览器可直接用，Electron 需适配 | 订单来了最像这一套 |
| click/type/press key | Playwright / Puppeteer / CDP | 外部浏览器可直接用，Electron 需适配 | Electron 可用 `webContents.debugger` 发 CDP |
| screenshot | Playwright / Puppeteer / Electron | 是 | 但文件落盘、安全路径要自控 |
| network listener | Playwright / Puppeteer / Electron session.webRequest / DevTools MCP | 是 | Electron 多 partition 要自己管理 |
| tab list/switch/open | Playwright tabs / Chrome DevTools MCP pages | 部分 | 业务 workspace/account/tab 要自研 |
| 多账号登录态隔离 | Electron `session.fromPartition` | API 可用，业务自研 | partition key 设计要自己做 |
| bridge.sock | Node `net` / JSON-RPC | 自研更简单 | 几十到几百行即可，但要做超时/并发/清理 |
| PMS context | 无通用开源 | 否 | 和订单来了 PMS 强绑定 |
| OTA account list | 无通用开源 | 否 | 业务状态模型 |
| skill 编排 | MCP + 本地 skill 目录 | 部分 | runtime 和 marketplace 要自研/选型 |
| 权限策略 | MCP client policy / 自研 | 需自研 | 经营数据场景必须做 |

## 对“browser是不是开源”的判断

如果问“订单来了的 `browser_*` 是不是直接用了某个开源 browser 工具”：

```text
不能确认它直接用了 @playwright/mcp。
但它的工具名、snapshot/ref 模式、动作约束，与 Playwright MCP 非常接近。
```

如果问“我们能不能直接用开源 browser 实现同类能力”：

```text
可以，但要分两种目标：

目标 A：独立浏览器自动化
  直接用 @playwright/mcp 或 chrome-devtools-mcp。

目标 B：像订单来了一样控制 Electron 内嵌 OTA/PMS 页签
  不能直接完整使用，需要自研 Electron adapter。
  可复用 MCP SDK、Playwright MCP 工具语义、Electron/CDP 官方 API。
```

## 推荐路线

### P0：直接跑通开源 browser MCP

先用 `@playwright/mcp` 跑通：

```text
browser_navigate
browser_snapshot
browser_click
browser_type
browser_take_screenshot
browser_network_requests
```

目的不是最终架构，而是验证 Agent 对 snapshot/ref 工具的使用体验。

### P1：做自己的 Electron Browser Tool Adapter

保留类似 Playwright MCP 的工具 schema，但执行层换成：

```text
MCP tools/call
  -> app bridge
  -> Electron main
  -> WebContentsView tab
  -> CDP / session.webRequest
```

### P2：业务层加 workspace/account/tab

增加：

- `browser_list_accounts`
- `browser_list_tabs`
- `browser_get_active_tab`
- `workspaceId`
- `accountId`
- `tabId`
- `targetHint`
- `tabUrlPattern`

### P3：加 PMS/OTA 安全围栏

增加：

- 只读工具和写工具分级。
- 改价/改库存/确认订单等高风险操作确认。
- 禁止模型猜业务 URL。
- 禁止通过 evaluate 改 router/location。
- 所有写操作落日志。

## 最终建议

不要从零写完整 browser agent；也不要直接把 Playwright MCP 当最终内嵌方案。

更稳的做法是：

```text
用 Playwright MCP 作为工具语义参考；
用 Chrome DevTools MCP 作为 CDP/daemon/调试参考；
用 Electron 官方 API 实现内嵌 WebContents adapter；
用 MCP SDK 暴露工具；
业务态、权限、账号隔离自己做。
```

