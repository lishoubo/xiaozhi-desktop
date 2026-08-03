# CDP 与 Codex Runtime 介绍

调研日期：2026-07-29

## 1. CDP 是什么

CDP 全称是 Chrome DevTools Protocol，中文可以叫 Chrome DevTools 协议。

它是 Chromium/Chrome/Blink 系浏览器暴露出来的一套远程调试与控制协议。Chrome DevTools 自己也是通过 CDP 去检查页面、调试 JS、看网络请求、做性能分析。第三方工具也可以通过 CDP 控制浏览器。

官方定义里有几个关键词：

```text
instrument
inspect
debug
profile
Chromium / Chrome / Blink-based browsers
```

换成人话：

```text
CDP = 程序化控制 Chrome 内核浏览器的底层遥控器
```

它不是一个 UI 框架，也不是自动化测试框架。它更底层，是 Playwright、Puppeteer、Chrome DevTools MCP、很多浏览器 Agent 工具背后的能力之一。

## 2. CDP 怎么工作

CDP 把浏览器能力拆成很多 domain：

- `DOM`
- `Runtime`
- `Network`
- `Page`
- `Input`
- `Accessibility`
- `CSS`
- `Performance`
- `Debugger`

每个 domain 下面有 command 和 event。

例如：

```text
Input.dispatchMouseEvent   派发鼠标事件
Input.dispatchKeyEvent     派发键盘事件
Input.insertText           输入文本
Runtime.evaluate           执行页面 JS
Page.captureScreenshot     截图
Network.enable             开启网络事件
DOM.getDocument            读取 DOM
Accessibility.getFullAXTree 读取可访问性树
```

CDP 消息本质上是 JSON-RPC 风格的结构化请求/响应。普通 Chrome 调试端口通常通过 WebSocket 暴露 target：

```text
http://127.0.0.1:9222/json/list
ws://127.0.0.1:9222/devtools/page/<targetId>
```

Electron 里不一定要开远程调试端口。主进程可以直接通过 `webContents.debugger` 调 CDP command。

## 3. CDP 和 Electron 的关系

Electron 内嵌的是 Chromium，所以 Electron 的页面也可以被 CDP 控制。

Electron 官方 `webContents` 是“渲染并控制网页”的对象。每个 BrowserWindow、BrowserView、WebContentsView 背后都有 `webContents`。`webContents` 上有：

```text
webContents.debugger
webContents.session
webContents.capturePage
```

这就解释了订单来了为什么能做到：

- 在内嵌 OTA/PMS 页面点击按钮。
- 输入文本。
- 截图。
- 监听网络请求。
- 读取页面结构。
- 跨 iframe 找元素。

它大概率不是靠系统级鼠标键盘模拟，而是靠 Electron 主进程持有 `webContents`，再通过 CDP/Session API 去操作页面。

## 4. CDP、Playwright、Puppeteer 的关系

可以这样理解：

```text
CDP
  -> 浏览器底层协议

Puppeteer
  -> 基于 CDP 的 Node.js 浏览器自动化库，主要面向 Chromium/Chrome

Playwright
  -> 更高层的自动化框架，支持 Chromium/Firefox/WebKit

Playwright MCP
  -> 把 Playwright 能力包装成 MCP tools 给 Agent/LLM 用

订单来了 browser_*
  -> 把 Electron 内嵌 WebContents/CDP 能力包装成 MCP tools 给 Codex Runtime 用
```

所以 CDP 是最底层的浏览器控制协议之一；Playwright/Puppeteer 是封装；MCP browser tools 是再往上的 Agent 工具接口。

## 5. Codex Runtime 是什么

这里要分清两个语境。

### OpenAI 官方语境

Codex 是 OpenAI 的软件工程 Agent 产品族。官方手册里把 Codex 分成多个使用面：

- Codex CLI：在终端和脚本里使用 Codex。
- Codex cloud：把任务委托到隔离的云环境。
- Codex IDE extension：在编辑器旁使用 Codex。
- ChatGPT desktop app / Codex app：桌面端交互。
- Codex SDK：用程序控制本地 Codex threads。
- Codex App Server：给深度集成客户端使用的本地接口。

官方手册明确说，OpenAI 开源了 Codex 的关键部分，包括：

- Codex CLI：`openai/codex`
- Codex SDK：`openai/codex/tree/main/sdk`
- Codex App Server：`openai/codex/tree/main/codex-rs/app-server`
- Skills：`openai/skills`
- Universal cloud environment：`openai/codex-universal`

但不是所有 Codex 产品都开源。官方列出的非开源部分包括：

- IDE extension
- Codex cloud

所以“Codex Runtime”不是“模型开源”。它更接近：

```text
运行 Codex Agent 的本地程序/服务/协议层
```

里面包括：

- 线程/会话管理。
- turn 运行。
- 工具调用。
- MCP server 接入。
- sandbox。
- approval。
- 文件读写与命令执行。
- 事件流。
- 认证。
- app-server JSON-RPC 接口。

模型仍然是远程或配置的模型服务；runtime 是把模型、工具、文件系统、MCP、权限和 UI 串起来的执行层。

### 订单来了语境

订单来了本地安装包里看到的是：

```text
@openai/codex = 0.140.0
@openai/codex-sdk
codex-primary-runtime
~/.smartorder/config.toml
~/.smartorder/skills
~/.smartorder/bridge.sock
smart-order-skills
```

它还配置了 MCP servers：

```text
browser
app-capabilities
so-agents
```

所以订单来了里的 “Codex Runtime” 可以理解为：

```text
订单来了把 OpenAI Codex 的本地 Agent runtime 嵌进了自己的桌面产品里，
再挂上自己的 browser/PMS/OTA MCP tools 和 smart-order skills。
```

它不是简单调用一次 OpenAI API，也不是只内置一个聊天窗口。它是把 Codex 当成本地 Agent 引擎，用来：

- 接收用户任务。
- 读取 skill。
- 调 browser_* 工具。
- 通过 MCP 调 PMS/OTA/应用能力。
- 操作内嵌浏览器。
- 保留 thread/state/log/memory。
- 和订单来了主进程桥接。

## 6. Codex Runtime 和 MCP 的关系

MCP 是工具协议。Codex Runtime 是调用工具的 Agent 运行时。

关系可以画成：

```text
Codex Runtime
  -> 读取 config.toml
  -> 启动/连接 MCP servers
  -> 获取 tools/list
  -> 模型决定调用工具
  -> tools/call
  -> MCP server 执行工具
  -> 工具结果回到模型上下文
```

在订单来了里：

```text
Codex Runtime
  -> browser MCP server
  -> bridge.sock
  -> Electron 主进程
  -> WebContents/CDP
  -> OTA/PMS 页面
```

所以 MCP server 只是“外接工具插槽”；Codex Runtime 才是“让 Agent 按回合运行、选择工具、处理结果、继续推理”的核心。

## 7. Codex App Server 是什么

官方 Codex App Server 是给“自己产品里深度集成 Codex”的接口。官方文档说它用于 rich clients，例如 Codex VS Code extension，能力包括：

- authentication
- conversation history
- approvals
- streamed agent events

App Server 支持 JSON-RPC 2.0 风格消息，传输包括：

- stdio
- WebSocket
- Unix socket
- off

核心对象包括：

- Thread：一段 Codex 对话。
- Turn：一次用户请求及后续 Agent 工作。
- Item：消息、命令、文件改动、工具调用等单元。

这和我们在订单来了里看到的运行态很像：它也有本地 state/log/memory/goal，MCP server，bridge socket，thread/turn 事件。

## 8. 和订单来了 browser_* 的关系

订单来了这套链路可以拆成三层：

```text
第一层：Codex Runtime
  负责 Agent、thread、turn、skills、MCP tools、权限和事件。

第二层：browser MCP server
  对 Codex 暴露 browser_* 工具；自己不直接持有 WebContents。

第三层：Electron browser bridge
  主进程持有 WebContents，最终用 CDP/session/webRequest 等能力操作页面。
```

也就是说：

```text
Codex Runtime 不是 browser 自动化本身；
browser_* 也不是 Codex Runtime 本身；
CDP 更不是 Codex Runtime。
```

三者关系是：

```text
Codex Runtime = Agent 执行和工具编排层
MCP browser tools = Agent 可调用的浏览器工具接口
CDP = 浏览器底层控制协议
```

## 9. 对我们有什么启发

如果我们做 RMS Desk，不需要从零发明所有概念：

```text
Agent Runtime:
  可以考虑 OpenAI Codex SDK/App Server 这类思路，或自建轻量 runtime。

Tool Protocol:
  用 MCP。

Browser Tool Schema:
  参考 Playwright MCP / 订单来了 browser_*。

Electron Browser Control:
  用 WebContentsView + session.fromPartition + webContents.debugger/CDP。

Business Layer:
  自研 workspace/account/tab、PMS/OTA 安全权限、订单/房价/库存策略。
```

最现实的路线：

```text
短期：
  用 Playwright MCP 验证 snapshot/ref 工具体验。

中期：
  自研 Electron WebContents adapter，工具 schema 尽量兼容 browser_* / Playwright MCP。

长期：
  引入 Codex SDK/App Server 或类似 runtime，把 browser、PMS、OTA、文件、报表工具统一接到 Agent 上。
```

## 10. 参考来源

- Chrome DevTools Protocol 官方说明：https://chromedevtools.github.io/devtools-protocol/
- Chrome DevTools Protocol Monitor：https://developer.chrome.com/docs/devtools/protocol-monitor
- Electron webContents：https://www.electronjs.org/docs/latest/api/web-contents
- Electron session：https://www.electronjs.org/docs/latest/api/session
- OpenAI Codex CLI：https://learn.chatgpt.com/docs/codex/cli.md
- OpenAI Codex App Server：https://learn.chatgpt.com/docs/app-server.md
- OpenAI Codex SDK：https://learn.chatgpt.com/docs/codex-sdk.md
- OpenAI Codex Open Source：https://learn.chatgpt.com/docs/open-source.md

