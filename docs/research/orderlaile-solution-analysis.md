# 订单来了 / Smart Order 方案分析

调研日期：2026-07-29

## 说明

本文只分析订单来了 / Smart Order 自身方案，不讨论本项目的实现方案。

信息来源分三类：

- 公开资料：官网、帮助中心、第三方集成说明、新闻稿。
- 本地安装包静态观察：`/Applications/订单来了.app`。
- 登录后本地状态只读观察：进程参数、本地状态文件、日志、partition 结构。

敏感信息处理：

- 未读取或记录 cookie、token、device auth 明文。
- 对本地文件只记录结构、字段、路径、域名统计和非敏感配置。

## 一句话结论

订单来了不是单纯 PMS，也不是单纯 RPA 工具，而是：

```text
云 PMS / Channel Manager
+ 多渠道账号和页签管理
+ Electron 桌面 AI 工作台
+ 内嵌 Chromium 浏览器
+ Codex runtime / skills / MCP 工具层
+ 远程 PMS Agent
```

它的主订单/库存闭环大概率在云 PMS 和 Channel Manager；桌面端更像一个“AI 操作台 + 渠道后台容器 + 工具执行入口”。

## 产品形态

从公开资料看，订单来了覆盖：

```text
PMS
房态日历
订单管理
前台办理
收银 / 财务 / 对账
房务
渠道直连 / Channel Manager
官网 / 小程序 / 社媒直营
统一消息
报表
AI 工作台
```

公开文案强调：

- 渠道直连。
- 价量态实时同步。
- 自动落单。
- 多渠道一键改价。
- 防超售。
- PMS、OTA 后台、本地文件和经营数据可被 AI 工作台连接。

整体产品定位更接近：

```text
酒店/民宿云 PMS + Channel Manager + AI 经营工作台
```

## 订单流方案

公开资料能支持的订单流是：

```text
OTA / 官网 / 小程序 / 社媒直营店
  -> 渠道直连 / Channel Manager
  -> PMS 自动落单
  -> 房态日历统一承接
  -> 入住、退房、换房、收银、对账、消息、房务
  -> 报表 / AI 工作台
```

关键点：

1. 订单不是先进入一个独立 inbox 再人工分发，而是进入房态/库存体系。
2. 新订单会占用 PMS 可售库存。
3. 库存变化再通过 Channel Manager 同步给其他渠道。
4. 取消、改期、异常订单会影响房态、库存、财务和统计。

## Channel Manager 能力

订单来了公开资料反复出现：

```text
渠道直连
价量态实时同步
自动落单
多渠道一键改价
防超售
```

Smart Order 与 PriceLabs 的集成说明进一步证明它有标准化的房型、价型、库存和限制规则模型。PriceLabs 可同步：

```text
日价格
最小入住晚数
入住限制
退房限制
未来 720 天价格
```

这说明 Smart Order 内部至少需要这些抽象：

```text
Property / Hotel
RoomType
RatePlan
Inventory
Rate
Restriction: minLOS / maxLOS / CTA / CTD
Reservation
ChannelMapping
```

公开渠道材料也显示，它覆盖国内外多类渠道：

```text
携程
美团
飞猪
抖音来客
小红书
Booking
Agoda
Expedia
Airbnb
Traveloka
tiket.com
美团民宿
途家
小猪民宿
木鸟民宿
```

## 异常订单处理：订单盒子

Smart Order 帮助中心有“订单盒子”功能。

公开说明显示：

- 订单移入订单盒子后不占库存。
- 订单金额不进入统计。
- 可用于冲突订单、刷单、保留单等。
- 移入后房量、房态变化会同步到已直连渠道。
- 如果不维护房态，房间会再次开放预订。

这个设计说明它对异常订单采用隔离机制：

```text
正常订单 -> 进入库存和营收统计
异常订单 -> 进入订单盒子，不占库存，不计营收，需单独处理
```

## 桌面端基础信息

本地安装路径：

```text
/Applications/订单来了.app
```

`Info.plist` 显示：

```text
CFBundleDisplayName = 订单来了
CFBundleIdentifier = com.ddll.ddlldesk
CFBundleShortVersionString = 1.3.6
CFBundleVersion = 1.3.6
NSPrincipalClass = AtomApplication
ElectronAsarIntegrity.Resources/app.asar = SHA256(...)
LSApplicationCategoryType = public.app-category.developer-tools
NSAllowsArbitraryLoads = true
NSAllowsLocalNetworking = true
```

包结构显示：

```text
Contents/Frameworks/Electron Framework.framework
Contents/Resources/app.asar
Contents/Resources/app.asar.unpacked
Contents/Resources/skills-catalog.json
Contents/Resources/release-runtime-config.json
Contents/Resources/codex-primary-runtime
Contents/Resources/smart-order-skills
```

结论：

```text
订单来了桌面端是 Electron 应用，内嵌 Chromium，并打包 AI runtime 和 skills。
```

## Release 配置

`release-runtime-config.json` 显示：

```text
edition = domestic
releaseEnv = prod
```

包内 release config 能看到多环境：

```text
test
staging
prod
```

生产环境关键地址：

```text
pmsUrl = https://www.dingdandao.com/
pmsUrlIntl = https://www2.smartorder.ai/
analyticsBaseUrl = https://mta.dingdanll.com/
cdnBaseUrl = https://fs.dingdandao.com/
```

## Codex Runtime

桌面包中包含：

```text
app.asar.unpacked/node_modules/@openai/codex
app.asar.unpacked/node_modules/@openai/codex-sdk
Resources/codex-primary-runtime
Resources/smart-order-skills
```

观察到版本：

```text
@openai/codex = 0.140.0
codex-primary-runtime bundleVersion = 26.619.11828
runtime nodeVersion = v24.14.0
runtime pythonVersion = 3.12.13
```

本地 AI home：

```text
~/.smartorder
```

里面包含：

```text
config.toml
skills/
logs_2.sqlite
memories_1.sqlite
goals_1.sqlite
state_5.sqlite
installation_id
```

可以理解为：

```text
Codex runtime = 订单来了 AI 工作台的本地 Agent 运行环境
```

它负责：

- 启动/管理 AI Agent。
- 读取技能和工具配置。
- 维护本地状态、日志、记忆和目标。
- 通过 MCP 调用浏览器、应用能力和远程 PMS Agent。

## Skills

`skills-catalog.json` 显示内置技能：

```text
browser-guide
documents
spreadsheet
pdf
```

`browser-guide` 的描述是：

```text
在已登录的商家后台页面中完成导航、点击与信息采集。
```

其操作流程：

```text
browser_snapshot
  -> browser_click / browser_type
  -> browser_snapshot
```

并强调：

- 每次操作前先获取最新快照。
- 表单填写前先点击输入框获得焦点。
- 导航到新页面后等待加载完成。
- 弹窗/确认框先处理。

这说明它把浏览器页面操作包装成 Agent 可调用的受控工具，而不是让模型直接随意执行脚本。

## MCP / 工具层

`~/.smartorder/config.toml` 脱敏结构显示三个 MCP server：

```text
[mcp_servers.browser]
command = "/Applications/订单来了.app/Contents/MacOS/订单来了"
args = [".../browser-mcp-server.js"]

[mcp_servers.app-capabilities]
command = "/Applications/订单来了.app/Contents/MacOS/订单来了"
args = [".../app-capabilities-mcp-server.js"]

[mcp_servers.so-agents]
enabled_tools = ["so_cli"]
bearer_token_env_var = "DDLL_SO_AGENTS_MCP_BEARER_TOKEN"
```

它通过：

```text
ELECTRON_RUN_AS_NODE=1
```

复用 Electron 可执行文件启动 Node 脚本。也就是说，同一个 App binary 既能作为 GUI App，也能作为本地工具 server 的 Node runtime。

可见工具名包括：

```text
pms_get_context
pms_query
pms_http_request
ota_account_list
execute_skill
browser_snapshot
browser_open
browser_navigate
browser_click
browser_type
browser_evaluate
browser_listen_request
browser_drain_listener
browser_take_screenshot
browser_open_tab
browser_list_tabs
browser_list_accounts
```

工具层可以分三类：

```text
Browser tools: 页面读取、点击、输入、截图、网络监听、页签/账号列表
PMS tools: PMS 上下文、查询、HTTP 请求
Business tools: execute_skill / so_cli / 远程 PMS Agent
```

## PMS Context

包内工具说明显示 `pms_get_context` 会从主进程读取：

```text
token
ntwIdNew
campName
type
finalVersion
currentNetwork
baseUrl
```

其中：

```text
ntwIdNew = 当前门店/网点 ID
baseUrl = 同源 PMS 后端 API 根地址
```

`ntwIdNew` 为空时，工具会返回不可用，并提示先选择 PMS 门店。

这个设计说明：

```text
PMS 查询/执行不是由模型猜接口，
而是先从主进程拿当前登录态和门店上下文，
再走受控工具。
```

## 内嵌浏览器和渠道工作区

订单来了桌面端内嵌 Chromium 浏览器，并把 PMS 和 OTA 渠道组织成 workspace/account/tab。

观察到的 workspaceId 映射：

```text
pms
ctrip
meituan
fliggy
douyin
xiaohongshu
booking
agoda
expedia
airbnb
traveloka
tiket
tripCom
meituanMinsu
tujia
xiaozhu
muniao
xiaohongshuPro
xiaohongshuNormal
```

包内渠道映射说明：

```text
携程 = ctrip
Trip.com / 携程渠道 = tripCom
美团酒店 / 普通美团 = meituan
飞猪 = fliggy
抖音来客 = douyin
小红书本地生活 = xiaohongshu
Booking = booking
Agoda = agoda
Expedia = expedia
Airbnb = airbnb
Traveloka = traveloka
tiket.com = tiket
美团民宿 = meituanMinsu
途家 = tujia
小猪民宿 = xiaozhu
木鸟民宿 = muniao
小红书专业号 = xiaohongshuPro
小红书普通号 = xiaohongshuNormal
```

部分渠道入口 URL：

```text
booking.entryUrl = https://admin.booking.cn/hotel/hoteladmin/groups/home/index.html?lang=zh
airbnb.entryUrl = https://www.airbnb.com/hosting
traveloka.entryUrl = https://tera.traveloka.com/login/
tiket.entryUrl = https://tix.tiket.com/app/login
tripCom.entryUrl = https://ebooking.trip.com/login/index
```

## 渠道 Session 同步

包内配置显示：

```text
channelSync.syncPath = /v2/ntw/web/client/public/channel/session/report
channelSync.syncIntervalMs = 1800000
```

`1800000ms = 30 分钟`。

这说明桌面端会维护并上报渠道 session 状态。它不是只把渠道页面打开给用户看，而是有渠道 session 生命周期管理。

## 登录后本地状态文件

登录后观察到：

```text
~/Library/Application Support/ddlldesk/workspace-state.prod.json
```

顶层字段：

```text
lastActiveTabId
lastActiveAccountId
lastActiveChannelWorkspaceId
trayHintShown
workspaces
```

workspace 结构：

```text
activeAccountId
accounts[]
hiddenAccounts[]
```

account 结构：

```text
id
name
activeTabId
tabs[]
isMuted
channelHotelName
channelUserLogin
channelState
loginState
loginStateUpdatedAt
loginStateSource
```

tab 结构：

```text
id
isPrimary
openerTabId
title
url
initialUrl
allowAnyUrl
titleLocked
```

这说明它把渠道状态持久化成：

```text
workspace -> account -> tab -> login/channel state
```

## 登录状态模型

观察到的登录状态：

```text
unknown
logged_out
```

观察到的登录状态来源：

```text
startup
display-fetch
xiaohongshu-normal
```

这说明登录状态不是简单 boolean，而是带来源和更新时间：

```text
loginState
loginStateUpdatedAt
loginStateSource
```

不同渠道可以有不同判断逻辑：

- 启动时判断。
- 从页面展示信息判断。
- 渠道特定逻辑判断。

## Electron Partition 隔离

登录后观察到每个渠道账号都有独立 Electron partition：

```text
~/Library/Application Support/ddlldesk/Partitions/ddlldesk%3Aprod%3A<workspaceId>%3A<accountId>/
```

解码后格式：

```text
ddlldesk:prod:<workspaceId>:<accountId>
```

每个 partition 下有自己的：

```text
Cookies
Session Storage
Local Storage
IndexedDB
Code Cache
Service Worker
```

只统计 cookie host，不读取 cookie 值，可以看到不同渠道分别落在自己的 partition：

```text
pms: .dingdandao.com
ctrip: .ctrip.com / ebooking.ctrip.com / s.c-ctrip.com
meituan: .meituan.com / me.meituan.com
fliggy: .fliggy.com / .mmstat.com
douyin: .douyin.com / life.douyin.com / oceanengine.com
booking: .booking.cn / admin.booking.cn / www.booking.cn
agoda: .agoda.com / ycs.agoda.com
expedia: .expediapartnercentral.com / .expedia.com
tujia: .tujia.com
xiaozhu: .xiaozhu.com
muniao: .muniao.com / www.muniao.com
xiaohongshu: .xiaohongshu.com / life.xiaohongshu.com / pro.xiaohongshu.com
```

这说明它隔离的不只是 cookie，而是整个 Chromium storage。

## 进程级渠道上下文

登录后运行中的 Electron renderer 进程参数可见：

```text
--ddll-workspace-id=tujia
--ddll-account-id=tujia-account-1
```

说明：

```text
workspaceId/accountId 被注入到 renderer 进程级上下文中。
```

这有利于：

- 日志归因。
- 崩溃诊断。
- 页面工具定位目标渠道。
- 渠道账号隔离。

## 本地通信通道

登录后观察到：

```text
~/Library/Application Support/ddlldesk/bus-port.json
~/.smartorder/bridge.sock
```

`bus-port.json` 包含：

```text
pid
port
```

该端口是本地 WebSocket 服务。普通 HTTP GET 返回：

```text
426 Upgrade Required
WebSocket upgrade required
```

`~/.smartorder/bridge.sock` 是 Unix socket。包内代码显示：

```text
browser MCP
app-capabilities MCP
execute_skill
```

都通过这个 bridge 转发到主进程。

因此本地通信大致是：

```text
Electron app internal bus: WebSocket
MCP/tools bridge: Unix socket
```

## 安全与隔离特征

观察到的安全/隔离设计：

```text
不同渠道账号使用不同 partition
远程页面没有直接 Node 权限
browser tools 通过受控 bridge 调主进程
MCP server 有 tool timeout
so-agents 使用 bearer_token_env_var
技能目录隔离到 ~/.smartorder
Electron userData 独立到 Application Support/ddlldesk
```

进程参数也能看到多数 renderer 带：

```text
--enable-sandbox
```

部分 renderer 带：

```text
--no-sandbox --no-zygote
```

这可能对应特定内部页面或工具页，具体原因需要进一步验证。

## 推断架构

基于公开资料和本地观察，订单来了整体架构大概率是：

```text
Desktop App
  Electron Main Process
    - workspace/account/tab manager
    - partition/session manager
    - PMS context provider
    - browser-context bridge
    - local websocket bus
    - Unix socket tool bridge
    - Codex runtime manager

  Renderer
    - PMS page
    - OTA channel pages
    - AI workbench
    - browser tabs

  Codex Runtime (~/.smartorder)
    - config.toml
    - skills
    - memories/logs/goals/state sqlite
    - MCP client/runtime

  MCP Servers
    - browser
    - app-capabilities
    - so-agents

Cloud
  - PMS API
  - Channel Manager
  - Analytics
  - Remote PMS Agent / so_cli
  - CDN / runtime updates
```

## 推断订单处理链路

主链路大概率是：

```text
OTA 新订单
  -> 官方 API / webhook / channel adapter / 拉单
  -> 标准化 reservation
  -> 幂等去重
  -> PMS 入库
  -> 扣减库存
  -> Channel Manager 同步其他渠道库存
  -> 前台日历 / App / AI 工作台通知
```

取消或改期：

```text
OTA 取消/修改
  -> 标准化为 reservation_cancelled / reservation_modified
  -> 更新订单和房态
  -> 释放或重算库存
  -> 同步价量态到其他渠道
  -> 触发财务、通知、异常校验
```

桌面 AI 工作台更可能参与：

```text
渠道后台登录
渠道 session 维护
巡店
异常订单检查
评价/消息处理
价格库存异常检查
页面操作接管
调用 PMS Agent 执行业务任务
```

## 关键设计模式

### 1. Workspace / Account / Tab

它把渠道后台抽象为：

```text
workspaceId -> accountId -> tabId
```

这比“打开一个浏览器页面”更适合多渠道、多账号、多门店。

### 2. Partition Per Account

每个渠道账号一个 Chromium partition：

```text
ddlldesk:prod:<workspaceId>:<accountId>
```

避免不同 OTA、不同账号之间 cookie/localStorage/sessionStorage 混用。

### 3. Context First

PMS 工具先拿上下文：

```text
pms_get_context
```

再执行查询/操作，避免模型猜 token、门店、baseUrl。

### 4. Snapshot-Based Browser Tools

页面操作走：

```text
snapshot -> ref -> click/type -> snapshot
```

而不是让模型随便执行 JS 或猜路由。

### 5. Local Runtime Isolation

AI runtime 独立到：

```text
~/.smartorder
```

桌面浏览器状态独立到：

```text
~/Library/Application Support/ddlldesk
```

### 6. Tool Bridge

Agent 不直接碰 Electron 内部对象，而是通过：

```text
MCP server -> bridge.sock -> main process
```

这样更容易做审批、超时、审计、错误处理和权限控制。

### 7. API 主链路 + 浏览器补洞

公开资料和本地浏览器能力结合看，订单来了不是纯 RPA，也不是纯 API：

```text
订单/库存主链路：云 PMS / Channel Manager / API
后台操作补洞：内嵌浏览器 / browser tools / AI Agent
```

## 参考来源

公开资料：

- https://dingdandao.com/pms?hash=pmsPagePro
- https://www.smartorder.ai/zh_cn/
- https://www.smartorder.ai/zh_cn/front-desk/
- https://www.smartorder.ai/zh_cn/vacation-rental-software/
- https://www.smartorder.ai/zh_CN/unified-inbox
- https://www.smartorder.ai/resources/zh/support/ding-dan-he-zi/
- https://www.smartorder.ai/resources/zh/support/ru-he-lian-jie-pricelabs/
- https://help.pricelabs.co/portal/en/kb/articles/how-to-integrate-pricelabs-with-smartorder
- https://hello.pricelabs.co/integrations/smart-order/
- https://henan.china.com/news/roll/2026/0625/062026_734913.html
- https://k.sina.com.cn/article_7880068235_1d5b04c8b01902e2os.html?from=tech

本地观察：

- `/Applications/订单来了.app/Contents/Info.plist`
- `/Applications/订单来了.app/Contents/Resources/app.asar`
- `/Applications/订单来了.app/Contents/Resources/skills-catalog.json`
- `/Applications/订单来了.app/Contents/Resources/release-runtime-config.json`
- `/Applications/订单来了.app/Contents/Resources/smart-order-skills/browser-guide/SKILL.md`
- `~/.smartorder/config.toml`
- `~/Library/Application Support/ddlldesk/workspace-state.prod.json`
- `~/Library/Application Support/ddlldesk/bus-port.json`
- `~/Library/Application Support/ddlldesk/Partitions/...`
