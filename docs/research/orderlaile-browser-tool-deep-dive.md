# 订单来了 browser_* 底层工具实现分析

本文只分析订单来了本地客户端里 `browser_*` 工具的实现形态，不复制其源码。结论来自本机安装包、运行态配置、进程参数和本地状态文件的只读观察。

## 一句话结论

订单来了的 `browser_*` 不是普通 Playwright 外挂浏览器，而是「Codex Runtime -> stdio MCP server -> Unix socket bridge -> Electron 主进程 -> 内嵌 WebContents/CDP」这一套内嵌浏览器自动化通道。

它把 AI 工具层、MCP 协议层和 Electron 浏览器控制层拆开：

```text
Codex Runtime / Agent
  -> MCP client
  -> browser-mcp-server.js（stdio MCP server）
  -> tools/list / tools/call
  -> bridge client
  -> ~/.smartorder/bridge.sock
  -> Electron main process bridge socket
  -> smartOrderBrowserToolHandlers
  -> browserContextBridge / browserContextTools
  -> WebContents / session / CDP debugger
  -> OTA / PMS 内嵌页面
```

## MCP server 怎么交互

本地 `~/.smartorder/config.toml` 里配置了一个名为 `browser` 的 MCP server。启动命令本质上是用订单来了自己的 Electron 可执行文件，以 Node 模式运行 `browser-mcp-server.js`：

```text
ELECTRON_RUN_AS_NODE=1
SMART_ORDER_BRIDGE_SOCKET=~/.smartorder/bridge.sock
/Applications/订单来了.app/Contents/MacOS/订单来了 .../browser-mcp-server.js
```

这个 server 使用 `@modelcontextprotocol/sdk` 的 `Server` 和 `StdioServerTransport`，也就是说 Codex Runtime 与它之间走标准 MCP stdio JSON-RPC。

它注册两个核心 MCP request handler：

- `tools/list`：返回 `browser_*`、`ota_account_list`、`pms_get_context`、`pms_http_request`、`list_skills`、`execute_skill` 等工具定义。
- `tools/call`：校验工具名和参数后，把调用转发到 `bridge.sock`。

MCP server 自己不直接控制浏览器。它更像一个协议适配器：对 Codex 暴露 MCP，对 Electron 主进程暴露 bridge client。

## bridge.sock 怎么工作

`bridge.sock` 是 Electron 主进程创建的 Unix Domain Socket。它的协议是换行分隔 JSON-RPC 2.0：

```json
{"jsonrpc":"2.0","id":1,"method":"browser_snapshot","params":{"tabId":"..."}}
```

每个请求以 `\n` 结尾。主进程逐行解析，拿到 `method` 和 `params` 后调用 `onToolCall(method, params)`。返回值再包装成：

```json
{"id":1,"result":{...}}
```

失败时返回 JSON-RPC error payload。代码里还能看到几个运行特征：

- 支持多个 socket client 连接。
- 请求逐行解析后并发处理，不阻塞同一连接上的后续请求。
- 有超时、pending request map、断开清理和 abort in-flight skill 机制。
- 主进程端记录 `bridge-socket.client-connected`、`bridge-socket.tool-call-failed`、`bridge-socket.listening` 等日志。

这个 bridge 的意义很明确：MCP 子进程不需要拿 Electron 内部对象，也不需要接触 WebContents 实例；它只发受控工具调用。真正有权限控制浏览器的逻辑留在 Electron 主进程。

## 主进程怎么分发 tool

主进程里维护了一个 `smartOrderBrowserToolHandlers` map。启动时把多类工具注册进去：

- `createBrowserContextTools(...)` 注册 `browser_*`。
- `createPmsSkillTools(...)` 注册 `pms_get_context`、`pms_http_request`。
- `createOtaSkillTools(...)` 注册 `ota_account_list`，并把它别名映射到 `browser_list_accounts`。
- `createVideoSkillTools(...)` 注册 `create_video_task`。
- 另外还有 `list_skills`、`execute_skill` 等与 skill MCP 相关的工具。

bridge 收到请求后，逻辑大致是：

```text
handler = smartOrderBrowserToolHandlers.get(method)
if missing -> unknown-tool
else -> handler(params)
```

所以 `browser-mcp-server.js` 只是工具入口；工具真正执行函数都在主进程已注册的 handler 里。

## 浏览器怎么被控制

从命名和运行态看，它是 Electron 内嵌浏览器方案。每个 OTA/PMS 账号对应独立浏览器上下文：

```text
~/Library/Application Support/ddlldesk/Partitions/ddlldesk%3Aprod%3A<workspaceId>%3A<accountId>/
```

也就是按 `prod + workspaceId + accountId` 隔离 cookie、localStorage、IndexedDB、Service Worker 等登录态。运行态页签状态在：

```text
~/Library/Application Support/ddlldesk/workspace-state.prod.json
```

里面保存 workspace、account、tab、activeTab、loginState、channelUserLogin、channelHotelName 等信息。`browser_*` 调用通常需要 `tabId`、`workspaceId`、`accountId`、`targetHint`、`tabUrlPattern` 或 `useActiveTab` 来定位目标页签。

具体页面操作落在 WebContents/CDP：

- 点击：先通过 snapshot/find/query 得到元素 `ref`，再解析到 frame 和坐标，最后用 CDP `Input.dispatchMouseEvent` 派发 mouseMoved、mousePressed、mouseReleased。
- 输入：点击聚焦后用 CDP `Input.insertText`；清空输入会组合 keyDown/keyUp 和 Delete。
- 按键：用 CDP `Input.dispatchKeyEvent`，支持修饰键 mask。
- hover：用 CDP mouseMoved。
- 滚动：在目标 frame 内执行 `scrollIntoView`。
- 截图：支持页面截图和元素截图，截图保存到受控临时目录，返回文件元信息，不直接返回 base64。
- 网络监听：基于目标页签/会话注册 URL pattern listener，`wait-once` 直接等一次命中，`collect` 返回 listenerId 后续 drain。

一个重要点是 iframe 处理：工具说明里明确说 snapshot 会拼接跨 iframe 内容，点击会通过 CDP 派发到正确 frame。也就是说它不是只在顶层 DOM 里 `document.querySelector`，而是维护了 frame-aware 的 ref 表。

## snapshot/ref 机制

`browser_snapshot` 是这套工具最核心的读页面能力。它返回压缩后的可访问性文本树：

- 每行一个节点。
- 可交互节点带 `[ref=e12]` 这类引用。
- input 会显示当前值。
- heading 带 level。
- iframe 内容会拼接进来。
- 大页面可以分页、限制深度、指定 target，或把完整快照落盘。
- 支持 diff 模式，只返回相对上次 snapshot 的变化区域。

`browser_click`、`browser_type`、`browser_select_option`、`browser_take_screenshot(ref=...)` 等工具都依赖最近一次 snapshot/find/query 产生的 ref。页面导航或 DOM 大幅变化后，ref 会被认为可能失效，必须重新 snapshot 或重新 query。

这套设计比直接让模型写 selector 稳定：模型看到的是有 ref 的页面语义树，执行层负责把 ref 翻译成 frame、元素矩形、坐标和 CDP 输入事件。

## 已看到的 browser 工具清单

浏览器与页签：

- `browser_list_accounts`
- `browser_list_tabs`
- `browser_get_active_tab`
- `browser_open`
- `browser_navigate`
- `browser_open_tab`
- `browser_switch_tab`
- `browser_wait_for`

页面读取：

- `browser_snapshot`
- `browser_find_text`
- `browser_query_elements`
- `browser_take_screenshot`

页面操作：

- `browser_click`
- `browser_hover`
- `browser_type`
- `browser_select_option`
- `browser_press_key`
- `browser_scroll_into_view`
- `browser_evaluate`

网络：

- `browser_listen_request`
- `browser_drain_listener`
- `browser_cancel_listener`

同一个 MCP server 里还混有几个业务/编排工具：

- `ota_account_list`
- `pms_get_context`
- `pms_http_request`
- `list_skills`
- `execute_skill`
- `create_video_task`

## 它的安全与约束设计

工具描述和系统提示里有几条很关键的防线：

- 页面内菜单/路由跳转默认必须通过真实页面元素完成：先 snapshot/find/query，再 click。
- 不要根据经验猜 OTA/PMS 的业务 URL，也不要用 `browser_evaluate` 改 `location/history/router` 来跳转。
- `browser_open` 是打开公共 URL 的入口，不要先读当前 active tab 后继承 workspace/account。
- 只有用户明确要求当前页签时才用 `browser_navigate`。
- 只有用户明确指定渠道账号新增子页签时才用 `browser_open_tab`。
- 涉及 PMS 数据变更时有单独 policy 提示，避免 AI 静默改库存、价格、房型等敏感经营数据。
- `pms_http_request` 被限制为技能编排底层 HTTP，不建议直接拿它查经营数据；调用前必须先 `pms_get_context`。
- 截图只返回受控文件路径/元信息，不向模型直接塞大块 base64。
- 大输出会截断并提示改用 target、pageSize、depth、filename、find/query 缩小范围。

这些约束的方向是：让模型少猜 URL、少写 selector、少直接发业务 HTTP，多通过用户可见页面和可审计工具链完成操作。

## 为什么不用纯 Playwright

它的需求和普通自动化测试不同：

- 需要复用用户已登录的 OTA/PMS 会话，而不是新开一个测试浏览器。
- 多渠道、多账号需要长期驻留、独立登录态和可视化切换。
- 页面要让用户可见，AI 操作的是用户桌面里真实打开的页面。
- 工具必须知道 workspace/account/tab 业务上下文。
- 部分能力要穿透到 PMS 页面内的 `window.http` 或 Electron session。
- Electron 主进程要做权限、日志、超时、敏感操作拦截。

所以它更像「Electron browser automation bridge」，不是「Playwright runner」。

## 可借鉴的 clean-room 实现蓝图

如果我们做类似能力，可以按下面结构实现，不需要复制它的代码：

```text
1. Electron 主进程
   - 管理 workspace/account/tab
   - 每个 account 使用独立 session partition
   - 注册 BrowserToolRegistry
   - 创建 Unix socket 或 localhost IPC bridge

2. MCP 子进程
   - 用 @modelcontextprotocol/sdk 暴露 stdio MCP
   - tools/list 返回稳定 schema
   - tools/call 校验参数后转发 bridge
   - 做输出截断和错误包装

3. Browser automation engine
   - snapshot engine：生成 accessibility/DOM 文本树和 ref map
   - ref resolver：ref -> frameId + element rect + click point
   - input controller：CDP mouse/key/insertText
   - screenshot controller：page/element screenshot -> temp file
   - network listener registry：URL pattern -> listenerId -> drain/cancel

4. Policy layer
   - 禁止模型猜业务路由
   - 高风险工具 require confirmation
   - HTTP 工具按 scope 授权
   - tab/account 目标必须显式或可解释
```

最值得学的是「ref 驱动的页面操作」和「MCP server 只做协议适配，Electron 主进程持有真实浏览器权限」这两个设计。它们能同时解决稳定性、登录态复用、权限隔离和用户可见性。

