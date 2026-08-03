# 订单来了 Tool 层观察

观察日期：2026-07-29

## 说明

本文记录订单来了桌面端中观察到的 tool / MCP / plugin 能力边界，不复制第三方实现源码。

来源：

- `/Applications/订单来了.app/Contents/Resources/app.asar`
- `~/.smartorder/config.toml`
- `~/.smartorder/codex-marketplaces/ddll-skill-market/prod/current/`

## Tool 分层

订单来了的工具层大致分为：

```text
1. browser MCP tools
2. PMS / OTA core tools
3. skill execution tools
4. app-capabilities tools
5. remote so-agents tools
6. media generation tools
7. marketplace plugins / skills
```

## MCP Servers

`~/.smartorder/config.toml` 里配置了 3 个 MCP server：

| MCP server | 作用 | 通信 |
| --- | --- | --- |
| `browser` | 浏览器工具 + Skill MCP 桥接 | `bridge.sock` |
| `app-capabilities` | 应用能力，例如文件上传 CDN | `bridge.sock` |
| `so-agents` | 远程 Smart Order PMS Agent | HTTP MCP |

其中：

```text
mcp_servers.browser.tool_timeout_sec = 3600
mcp_servers.app-capabilities.tool_timeout_sec = 360
mcp_servers.so-agents.tool_timeout_sec = 600
```

`browser` 和 `app-capabilities` 都通过：

```text
ELECTRON_RUN_AS_NODE=1
SMART_ORDER_BRIDGE_SOCKET=~/.smartorder/bridge.sock
```

复用订单来了 Electron 可执行文件启动本地 Node MCP server。

## Browser Tools

观察到的浏览器工具：

| Tool | 中文名 | 作用 |
| --- | --- | --- |
| `browser_list_accounts` | 列出账号 | 列出桌面端 OTA/PMS 工作区及渠道账号 |
| `browser_list_tabs` | 列出标签页 | 列出当前运行中的内嵌浏览器页签 |
| `browser_get_active_tab` | 获取当前标签页 | 获取当前活跃 tab |
| `browser_snapshot` | 页面快照 | 获取紧凑可访问性文本快照，节点带 ref |
| `browser_find_text` | 查找页面文字 | 按文案查找最小可见节点和可操作父节点 |
| `browser_query_elements` | 查询页面元素 | 按 selector、role、name、text 查询节点 |
| `browser_take_screenshot` | 页面截图 | 截取页面或元素，保存到受控临时目录 |
| `browser_open` | 打开网址 | 打开公共网址，按 URL origin 选择上下文 |
| `browser_navigate` | 打开页面 | 让目标页签导航到指定 URL |
| `browser_open_tab` | 渠道内新建标签 | 在指定渠道账号下打开新标签 |
| `browser_switch_tab` | 切换标签页 | 切换到指定 tab |
| `browser_wait_for` | 等待页面状态 | 等待文本、元素、导航或超时 |
| `browser_click` | 点击元素 | 点击 snapshot/find/query 返回的 ref |
| `browser_hover` | 悬停元素 | 悬停触发菜单、tooltip 等 |
| `browser_type` | 输入文字 | 聚焦输入类元素并输入文本 |
| `browser_select_option` | 选择下拉选项 | 操作原生 select |
| `browser_press_key` | 按键 | 派发键盘按键 |
| `browser_scroll_into_view` | 滚动到元素 | 把 ref 元素滚动到视口 |
| `browser_evaluate` | 执行页面脚本 | 在目标页签主 world 执行 JS 表达式 |
| `browser_listen_request` | 监听网络请求 | 注册 URL 匹配的网络请求监听器 |
| `browser_drain_listener` | 读取网络监听 | 读取 listener 命中的请求记录 |
| `browser_cancel_listener` | 取消网络监听 | 取消已注册 listener |

### Browser Tool 设计规则

包内提示词里明确了几条规则：

- 页面内菜单/路由跳转必须先 `browser_snapshot` / `browser_find_text` / `browser_query_elements` 找到真实元素，再 `browser_click`。
- 不要根据页面文案、渠道名称或经验猜业务 URL/路由。
- 不要用 `browser_open`、`browser_navigate`、`browser_open_tab` 或 `browser_evaluate` 修改 `location/history/router` 来完成业务页面跳转。
- 用户给出公共 URL、官网、搜索引擎时，才默认用 `browser_open`。
- `browser_snapshot` 支持大页面落盘、diff 模式、分页、聚焦子树。
- 截图保存为文件元信息，不返回 base64。
- 操作 ref 前需要来自最近一次 snapshot/find/query；页面变化后要重新取快照。

## PMS / OTA Core Tools

| Tool | 中文名 | 作用 |
| --- | --- | --- |
| `ota_account_list` | 列出 OTA 渠道账号 | 列出桌面端工作区及账号，支持按 `workspaceId`、`accountId`、`channelUserLogin`、`onlyLoggedIn` 过滤 |
| `pms_get_context` | 获取 PMS 登录上下文 | 从主进程读取 PMS token、门店 ID、baseUrl 等上下文 |
| `pms_http_request` | PMS HTTP 请求 | 通过 PMS 页面浏览器上下文代理执行 HTTP 请求 |
| `pms_query` | 查询 PMS 数据 | UI 文案中存在，但实际实现可能走 PMS Agent / skill |

### pms_get_context 返回模型

观察到的上下文字段：

```text
token
ntwIdNew
campName
type
finalVersion
currentNetwork
baseUrl
available
hint
reason
```

`ntwIdNew` 是当前门店/网点 ID。为空时工具会提示先选择 PMS 门店。

### pms_http_request 限制

包内提示明确：

- 调用前必须先 `pms_get_context`。
- 如果 `available=false`、token 为空或 `ntwIdNew` 为空，应停止。
- 不要用 `pms_http_request` 处理库存、房价、渠道、房型等经营数据查询。

这说明底层 HTTP 是受限兜底工具，不是所有 PMS 业务查询的默认入口。

## Skill Execution Tools

| Tool | 作用 |
| --- | --- |
| `list_skills` | 列出可执行 skill 及 schema |
| `execute_skill` | 执行指定 skill |

观察到的规则：

- `execute_skill` 通过 bridge 调用 Skill MCP。
- 单店默认超时 10 分钟。
- 跨店 fan-out 曾有设计，但当前提示 2 家及以上门店“跨店操作暂不可用”。
- 渠道巡店任务建议先用 `ota_account_list(workspaceId=..., onlyLoggedIn=true)` 获取账号，再按 `list_skills` schema 调 `execute_skill`。
- `execute_skill` 有串行锁，避免并发调用互相覆盖。

## App Capabilities Tools

观察到：

| Tool | 作用 |
| --- | --- |
| `upload_file_to_cdn` | 由主进程实现，把文件上传到 CDN |

这类工具在 `app-capabilities` MCP server 下，经同一个 `bridge.sock` 转发。

## Remote so-agents Tool

`config.toml` 中：

```text
[mcp_servers.so-agents]
enabled_tools = ["so_cli"]
```

说明有一个远程 Smart Order PMS Agent HTTP MCP，仅暴露：

```text
so_cli
```

推断用途：

- 执行 PMS 业务 Agent 能力。
- 查询/操作 PMS 业务数据。
- 作为本地 AI 工作台和云端业务能力之间的桥。

鉴权通过：

```text
bearer_token_env_var
```

## Media Tools

观察到：

| Tool | 作用 |
| --- | --- |
| `create_video_task` | 创建视频生成任务 |

`video-generation` skill 明确要求通过 `create_video_task` 提交任务，不经脚本或直连 HTTP。

图片生成目录里有本地脚本：

```text
image-generation/scripts/generate_image.mjs
```

图片能力更像脚本封装；视频能力更像受控 tool。

## Core Tool Set

包内有核心工具集合：

```text
execute_skill
pms_get_context
pms_http_request
ota_account_list
create_video_task
```

这些是注入 Agent 的核心工具。browser 工具族也在 browser MCP 中暴露，但 core set 单独列出以上工具。

## Marketplace Plugins

登录后 `config.toml` 中出现本地市场：

```text
[marketplaces.ddll-skill-market]
source_type = "local"
source = "~/.smartorder/codex-marketplaces/ddll-skill-market/prod/current"
```

当前启用插件：

```text
ctrip-helper
meituan-helper
PMSInquiryGuide
```

市场目录中观察到多个业务相关插件：

| Plugin | 显示名 | 用途 |
| --- | --- | --- |
| `ctrip-helper` | 携程巡店 | 根据已登录携程 Ebooking 账号生成结构化巡店报告 |
| `meituan-helper` | 美团巡店 | 根据已登录美团账号生成酒店经营数据分析报告 |
| `PMSInquiryGuide` | PMC-CLI | 对 PMS 做相关查询和操作 |
| `hotel-ota-diagnostic-proposal` | 酒店OTA诊断方案 | 根据门店、竞对和公开 OTA 信息生成运营诊断与整改计划 |
| `ctrip-review-order-matcher` | 携程点评倒查订单小助手 | 读取携程点评/问答/差评并反查 PMS 订单候选 |
| `ctrip-competitor-workbook` | 携程外网数据抓取 | 抓取携程基础信息和房型价格，生成 Excel 与核检文档 |
| `ctrip-pyramid-ad-assistant` | 携程金字塔助手 | 巡检携程金字塔广告投放，生成诊断报告和投放建议 |
| `pms-weiguanwan` | 微官网装修助手 | 生成小程序主页装修图和页面素材 |
| `pms-xhs-xiaochengxu-auto` | 小红书小程序自动上货 | 整理套餐资料并创建到 PMS 后台 |

从 manifest 看，大多数 marketplace plugin 是 skills 包，不一定自带 MCP server。它们复用全局工具：

```text
browser_*
ota_account_list
pms_get_context
execute_skill
so_cli
documents/spreadsheets/pdf plugins
```

## Tool 架构判断

订单来了的 tool 架构不是“每个业务插件一个独立工具后端”，而更像：

```text
通用底层工具：
  browser_*
  pms_get_context
  pms_http_request
  ota_account_list
  upload_file_to_cdn
  create_video_task
  so_cli

业务插件 / skill：
  ctrip-helper
  meituan-helper
  PMSInquiryGuide
  ...

业务插件通过底层工具完成任务。
```

这能降低工具数量爆炸，同时让每个业务插件只负责流程、提示词和参数 schema。

