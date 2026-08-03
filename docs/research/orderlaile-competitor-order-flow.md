# 订单来了 / Smart Order 竞品订单流方案调研

调研日期：2026-07-29

本地 App 观察日期：2026-07-29

## 结论

订单来了的公开方案核心不是“桌面端登录 OTA 后台再抓订单”，而是：

```text
OTA / 官网 / 小程序 / 社媒直营店
  -> 渠道直连 / Channel Manager
  -> PMS 自动落单
  -> 房态日历统一承接
  -> 入住、退房、换房、收银、对账、消息、房务
  -> 数据报表 / AI 工作台
```

也就是说，它更像“云 PMS + 渠道管理 + 前台运营 + AI 工作台”的一体化系统。订单来了强调的是平台直连、自动落单、防超售、多端同步和经营动作自动化；这和我们当前文档里的“Electron + RPA worker + 内嵌浏览器 + 本地 SQLite”的桌面自动化路线不同。

## 公开材料能看到的能力

### 1. 渠道订单自动落单到 PMS

订单来了官网 PMS 页面写到，基础版支持美团民宿、小猪民宿、途家、木鸟民宿等短租渠道直连，专业版/商务版支持携程、飞猪、美团、小猪、途家、木鸟等主流渠道直连。公开文案明确提到“价量态实时同步，自动落单，多渠道一键改价”。

Smart Order 国际站也明确说，渠道订单会自动落单至 PMS，同时管理多个渠道的价格与库存，目标是避免超额预订。

来源：

- https://dingdandao.com/pms?hash=pmsPagePro
- https://www.smartorder.ai/zh_cn/

### 2. 房态日历是订单承接中心

Smart Order 前台管理页描述的是“一个房态界面，把控全渠道订单”：所有渠道订单和独立站订单会自动进入日历房态，前台在同一界面完成入住、退房、换房、关房和新增预订。

这说明它的订单流不是先进入一个独立 inbox 再人工分发，而是直接进入房态/库存体系，订单天然影响可售房量。

来源：

- https://www.smartorder.ai/zh_cn/front-desk/

### 3. Channel Manager 承担防超售和同步

订单来了功能页把“渠道直连”定义为一站式管理 OTA、社媒渠道、微信生态等多平台的价格、房量、房态和订单；公开文案强调“不用来回切换跳转人工搬单”。

行业材料也能印证这个模式：Channel Manager 的职责是把房量与房价同步到各渠道，并把订单收回统一管理；任一渠道成交后，房量会实时从其他渠道扣除，以降低超卖风险。RMS 是策略层，Channel Manager 是执行层。

来源：

- https://www.pwpnetwork.com/function
- https://rms.mrhost.com.tw/cn/news/channel-manager

### 4. 订单盒子处理冲突单 / 刷单 / 保留单

Smart Order 帮助中心有“订单盒子”功能：订单移入订单盒子后不占库存，订单金额不统计，可用于冲突订单、刷单、保留单等。移入后房量、房态变化会同步到已直连渠道，若不维护房态，房间会再次开放预订。

这体现了它对异常订单的处理逻辑：异常单从正常库存和营收统计里摘出来，同时把库存状态同步给渠道。

来源：

- https://www.smartorder.ai/resources/zh/support/ding-dan-he-zi/

### 5. AI 工作台偏“经营动作执行”，不是只做分析

2026 年公开新闻稿里，订单来了把 AI 工作台描述为基于云 PMS 的行业 AI 操作系统，连接 PMS、AI 浏览器、OTA 渠道后台、本地文件与经营数据，能根据经营目标自动拆解任务、调用工具、执行操作并回传结果。

材料里的例子包括：自动巡检 OTA 渠道异常订单、待回复评价、价格与库存异常，并整理优先级清单。这里的 AI 更像“跨系统经营任务执行层”，不是单纯报表问答。

来源：

- https://henan.china.com/news/roll/2026/0625/062026_734913.html
- https://k.sina.com.cn/article_7880068235_1d5b04c8b01902e2os.html?from=tech

## 和我们当前方案的差异

| 维度 | 订单来了 / Smart Order | 我们当前 docs 方案 |
| --- | --- | --- |
| 系统形态 | 云 PMS / Channel Manager / 多端 App / AI 工作台 | Electron 桌面端 + Python RPA sidecar + 本地 SQLite |
| 订单来源 | 平台直连、官网、小程序、社媒直营店自动落单 | 通过 OTA 后台登录态、浏览器请求监听、HTTP/RPA 抓取 |
| 核心闭环 | 订单自动入 PMS，实时占房量，联动渠道库存 | 先抓取结构化数据，再做分析、建议和人工确认执行 |
| 防超售 | 依赖渠道直连实时同步价量态 | 需要靠抓取频率、结果校验、人工接管或开放 API 兜底 |
| 异常订单 | 订单盒子释放库存、不计营收、同步房态变化 | 当前 docs 尚未定义异常订单隔离模型 |
| AI 角色 | 连接 PMS、OTA 后台、本地文件，执行经营任务 | Agent 分析结构化数据，生成建议，高风险动作人工确认 |

## 他们大概率采用的技术方案

以下是基于公开产品能力的推断，不等同于订单来了官方披露的内部架构。

### 公开材料能支撑的技术事实

1. 它是云端 PMS，不是纯本地软件。

官网明确提供 PC、App、多端同步、云端 PMS、移动管理能力。这类产品通常以云端后端作为数据中心，本地客户端只是访问端。

2. 它具备 Channel Manager 能力。

公开材料反复出现“渠道直连”“价量态实时同步”“自动落单”“防超售”。这意味着它不是只做页面自动化，而是把 OTA、官网订房引擎、小程序、社媒直营店的订单和库存汇总到统一渠道管理层。

3. 它有标准化的房型、价型、库存、限制规则模型。

PriceLabs 与 Smart Order 的连接教程显示，PriceLabs 可向 Smart Order 同步日价格、最小入住晚数、入住/退房限制等，最多可同步未来 720 天。Smart Order 侧需要选择房型和价格计划，并将 PriceLabs 价格继续同步到 Smart Order 以及各 OTA 直连渠道。

这说明 Smart Order 内部大概率已经抽象了：

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

来源：

- https://www.smartorder.ai/resources/zh/support/ru-he-lian-jie-pricelabs/
- https://help.pricelabs.co/portal/en/kb/articles/how-to-integrate-pricelabs-with-smartorder

4. 它支持第三方集成，不只是自家闭环。

PriceLabs 官方把 Smart Order 归类在 “PMS / Channel Manager” 集成路径里。Smart Order 帮助中心也有 Booking.com、Agoda、Airbnb 等连接指南分类。这说明它更像一个渠道集成平台，而不是一个单纯 PMS 表单系统。

来源：

- https://www.smartorder.ai/resources/support/page/4/
- https://hello.pricelabs.co/integrations/smart-order/

### 大概率后端架构

```text
Web / App / AI Client
  -> API Gateway / BFF
  -> PMS Core Service
      - reservation
      - room calendar
      - rate plan
      - inventory
      - guest profile
      - payment / invoice
      - housekeeping
  -> Channel Manager Service
      - channel adapter
      - mapping engine
      - rate/inventory push
      - reservation pull/webhook receive
      - retry / reconciliation
  -> Integration Service
      - PriceLabs
      - payment gateways
      - smart lock
      - message inbox
  -> Data / Report / AI Workspace
```

更具体一点：

- 数据中心：云数据库保存 PMS 主数据，PMS 是订单和房态的 source of truth。
- 渠道适配层：每个 OTA 一个 adapter，负责把内部房型、价型、库存、订单状态映射成渠道协议。
- 同步机制：有些渠道可能走官方 API / webhook，有些走轮询，有些可能仍然需要半自动或运营介入。
- 异步任务：价格库存推送、订单拉取、失败重试、对账校验大概率走任务队列。
- 幂等和对账：订单创建、取消、改期、库存扣减必须有幂等键和 reconciliation，不然很容易重复落单或漏同步。
- 多端一致性：Web、App、AI 客户端共用云端 API 和同一套权限/审计。
- AI 工作台：大概率不是直接修改数据库，而是调用 PMS/Channel/Browser/文件等工具接口，并保留人工确认和执行回传。

### 订单流大概率是这样

```text
OTA 新订单
  -> OTA webhook 或定时拉单
  -> channel adapter 标准化订单
  -> 幂等去重
  -> 映射到内部房型/价型/房间
  -> 写入 reservation
  -> 扣减 PMS 可售库存
  -> 触发 channel manager 向其他渠道同步库存
  -> 通知前台日历 / App / 消息
  -> 进入入住、收银、对账、房务流程
```

如果是取消或改期：

```text
OTA 取消/修改
  -> 标准化为 reservation_cancelled / reservation_modified
  -> 更新订单状态和房态
  -> 释放或重算库存
  -> 同步价量态到其他渠道
  -> 触发财务、通知、异常校验
```

### 他们可能也有“AI 浏览器 / 自动化”，但不是主订单链路

2026 年新闻稿提到订单来了 AI 操作系统连接 PMS、AI 浏览器、OTA 渠道后台、本地文件和经营数据。这个信息很关键：

- 对官方 API 已打通的渠道，订单主链路大概率走 API / Channel Manager。
- 对不能稳定 API 化的后台操作，AI 浏览器可能用于巡检、评价回复、异常处理、营销内容发布、后台配置等。
- 所以它可能是“API 主链路 + 浏览器自动化补洞”，而不是“RPA 抓单作为主链路”。

这和我们现在桌面方案正好相反：我们短期是“浏览器/RPA 主链路 + API 能接则接”。

## 技术方案对比

| 维度 | 订单来了大概率方案 | 我们当前方案 |
| --- | --- | --- |
| 架构重心 | 云端 SaaS，多端访问 | 本地桌面端，sidecar 执行 |
| 订单入口 | OTA 官方直连、webhook/拉单、官网/小程序内生订单 | 用户登录 OTA 后台，复用登录态抓取/监听 |
| 数据源权威 | 云 PMS 数据库是 source of truth | 本地 SQLite 是分析与任务数据源，OTA/PMS 仍是外部权威 |
| 同步方向 | PMS -> Channel Manager -> OTA 双向同步 | OTA 后台 -> 本地抓取；执行动作再反写 OTA |
| 实时性 | 高，取决于渠道 API 和队列延迟 | 中低，取决于抓取频率、登录态、风控、页面稳定性 |
| 防超售能力 | 强，靠库存统一扣减和跨渠道同步 | 弱到中，需要频繁巡检、校验和人工兜底 |
| 稳定性 | 渠道 API 稳定时较高，但集成成本高 | 不依赖官方合作，落地快，但页面变化/风控风险高 |
| 开发门槛 | OTA 合作、渠道映射、幂等、对账、SLA 都重 | 桌面工程、RPA 稳定性、登录态、诊断和恢复更重 |
| 商业壁垒 | 渠道合作关系、历史数据、PMS 工作流迁移成本 | 轻量部署、低接入门槛、覆盖未开放 API 的平台 |
| 适合客户 | 愿意把 PMS 迁到它系统里的商家 | 已经在多个 OTA/PMS 后台运营、不想迁系统的商家 |

## 对我们路线的判断

订单来了的技术壁垒主要在“渠道直连 + PMS 数据闭环”。如果我们正面复制，短期会被 OTA 接口、渠道合作、PMS 迁移、支付/财务/门锁/房务等范围拖住。

我们当前桌面方案的差异化应该是：

```text
不要求商家迁 PMS
不要求先拿 OTA 官方接口
先通过本地浏览器/RPA 把现有后台数据接进来
做经营异常发现、价格库存巡检、订单变化提醒、半自动执行
后续再把高价值平台逐步 API 化
```

因此比较合理的产品定位不是“做一个新的订单来了”，而是：

```text
订单来了 = 云 PMS / Channel Manager
我们 = 酒店 OTA 经营副驾 / 本地自动化运营台
```

中长期如果要补齐竞争力，建议从技术上分三层演进：

1. 本地 RPA 订单事件化：先把抓到的订单变化建成标准事件，不直接依赖页面结构。
2. 异常与执行闭环：新订单、取消、改期、库存冲突、价格异常进入统一 review queue。
3. 渠道 API 化：对高价值渠道逐步接官方 API，让部分链路从 RPA 升级为 Channel Adapter。

## 本地安装包观察

本机安装路径：

```text
/Applications/订单来了.app
```

只做了静态只读观察，未启动 App，未读取 cookie/token 明文。

### 安装包基础信息

`Info.plist` 显示：

```text
CFBundleIdentifier = com.ddll.ddlldesk
CFBundleShortVersionString = 1.3.6
NSPrincipalClass = AtomApplication
ElectronAsarIntegrity.Resources/app.asar = SHA256(...)
```

包结构显示它是 Electron 应用：

```text
Contents/Frameworks/Electron Framework.framework
Contents/Resources/app.asar
Contents/Resources/app.asar.unpacked
Contents/Resources/smart-order-skills
Contents/Resources/codex-primary-runtime
```

这说明“订单来了桌面端”不是普通原生 App，也不是纯浏览器壳，而是 Electron + 内嵌 Chromium + Node 侧能力。

### 本地 AI / Agent 运行结构

包内有：

```text
app.asar.unpacked/node_modules/@openai/codex/package.json
app.asar.unpacked/node_modules/@openai/codex-sdk/package.json
Resources/codex-primary-runtime/latest/darwin-arm64/LATEST.json
Resources/smart-order-skills/browser-guide/SKILL.md
Resources/skills-catalog.json
```

观察到的版本：

```text
@openai/codex = 0.140.0
codex-primary-runtime bundleVersion = 26.619.11828
runtime nodeVersion = v24.14.0
runtime pythonVersion = 3.12.13
```

`skills-catalog.json` 内置技能包括：

```text
browser-guide: 浏览器操作助手
documents: Word 文档
spreadsheet: Excel 表格
pdf: PDF
```

其中 `browser-guide` 的说明是：在已登录的商家后台页面中完成导航、点击和信息采集。操作流程是 `browser_snapshot -> browser_click/browser_type -> browser_snapshot`。

这基本确认它的桌面端内置了一个 AI 工作台，而不是只把云 PMS 页面嵌进去。

### 本地状态目录

观察到本地目录：

```text
~/.smartorder
~/Library/Application Support/ddlldesk
~/Library/Logs/ddlldesk
~/Library/Preferences/com.ddll.ddlldesk.plist
```

其中：

- `~/.smartorder`：Codex/AI 工作台 home，包含 skills、config.toml、state/goals/memories/logs sqlite。
- `~/Library/Application Support/ddlldesk`：Electron profile、Cookies、Session Storage、Local State、device auth、sentry 等。
- `~/Library/Logs/ddlldesk`：桌面端日志。

这说明它把 AI runtime 和 Electron 浏览器 profile 分开管理：

```text
AI / MCP / skills / memories -> ~/.smartorder
Electron session / cookies / app data -> Application Support/ddlldesk
```

### MCP / 工具编排

脱敏后的 `~/.smartorder/config.toml` 显示三个核心 MCP server：

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

它通过 `ELECTRON_RUN_AS_NODE=1` 复用 Electron 可执行文件启动 Node 脚本。这是 Electron 应用里常见的 sidecar 方式：同一个 app binary 既能作为 GUI 启动，也能作为 Node runtime 启动后台工具服务。

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

这说明它的 AI 工作台至少有三类能力：

1. 读取 PMS 登录上下文和 PMS API 根地址。
2. 操作内嵌浏览器页面，包括点击、输入、截图、网络监听。
3. 调远程 `so-agents` PMS Agent，通过 `so_cli` 执行业务能力。

### PMS 上下文模型

包内注释和工具说明显示：

```text
pms_get_context:
  token
  ntwIdNew
  campName
  type
  finalVersion
  currentNetwork
  baseUrl
```

其中 `ntwIdNew` 是当前门店/网点 ID；为空时会返回不可用并提示“请先选择 PMS 门店”。

这说明它的 PMS 查询/执行不是直接让模型猜接口，而是先从主进程拿当前登录态和门店上下文，再调用受控工具。这个设计比“把页面 DOM 丢给模型”稳很多。

### 渠道工作区与内嵌渠道浏览器

包内出现了明确的渠道 `workspaceId` 映射：

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

还观察到渠道入口和 cookie domain 配置，例如：

```text
channelSync.syncPath = /v2/ntw/web/client/public/channel/session/report
channelSync.syncIntervalMs = 1800000
booking.entryUrl = https://admin.booking.cn/hotel/hoteladmin/groups/home/index.html?lang=zh
airbnb.entryUrl = https://www.airbnb.com/hosting
traveloka.entryUrl = https://tera.traveloka.com/login/
tiket.entryUrl = https://tix.tiket.com/app/login
tripCom.entryUrl = https://ebooking.trip.com/login/index
```

这说明桌面端内置了“渠道工作区 / 渠道账号 / 渠道页签”的抽象，并且会定时上报或同步渠道 session 状态。

### 对技术方案判断的修正

本地 App 观察后，之前的判断可以更精确：

```text
公开主链路：云 PMS + Channel Manager + 渠道直连
桌面 AI 侧链路：Electron + 内嵌渠道浏览器 + Codex runtime + MCP bridge + 远程 PMS Agent
```

订单来了不是只有 API 方案，也不是只有 RPA 方案。更像：

```text
PMS/订单/库存权威数据在云端
渠道直连负责主同步链路
桌面端负责 AI 工作台、渠道后台登录、浏览器接管、巡店、异常处理和工具执行
```

也就是说，它已经在做我们 docs 里设想的“Browser for session / HTTP for data / Browser automation for hard actions”，但它的基础盘更重：背后有自家 PMS、渠道映射和远程业务 agent。

## 本地 App 与我们方案的进一步对比

先明确一点：我们和订单来了都采用“内嵌浏览器”。真正差异不是有没有浏览器，而是：

```text
浏览器承载什么上下文
浏览器后面接什么工具层
数据权威在哪里
订单/库存动作由谁闭环
```

| 维度 | 订单来了本地 App | 我们当前方案 |
| --- | --- | --- |
| 桌面框架 | Electron | 计划 Electron |
| 内嵌浏览器 | 有，支持渠道页签、账号、snapshot、click/type、网络监听 | 计划 WebContentsView + RPA worker |
| AI runtime | 打包 Codex CLI/SDK + primary runtime + skills | 计划本地 Agent 编排，尚未落地 |
| 工具协议 | MCP server：browser、app-capabilities、so-agents | 可参考 MCP/本地 API，但当前 docs 未定 |
| PMS 登录上下文 | 主进程提供 token、门店 ID、baseUrl | 我们需要定义 profile/cookie/storageState/context 提取模型 |
| 业务执行 | execute_skill + so_cli + PMS Agent | 计划 RPA worker/Local API 执行 |
| 渠道模型 | workspaceId/accountId/channelUserLogin/onlyLoggedIn/includeHiddenChannels | 我们需要补 OTA workspace/account 抽象 |
| 渠道 session | 有 syncPath 和 syncIntervalMs，定时同步 session 状态 | 我们需要补登录态健康检查和 session 上报/本地状态 |
| 跨店 | 代码里有 fan-out 设计，但当前提示“跨店操作暂不可用” | 我们第一版建议单店优先 |
| 数据权威 | 云 PMS | 本地 SQLite + 外部 OTA/PMS |

### 内嵌浏览器方案的关键差异

| 维度 | 订单来了 | 我们当前 docs |
| --- | --- | --- |
| 浏览器类型 | Electron 内嵌 Chromium | Electron WebContentsView |
| 主要页面 | 自家 PMS + 多 OTA 渠道后台 + AI 工作台 | OTA 后台 + 我们 React UI |
| 页面组织 | workspaceId / accountId / tabId | 目前只写到平台/酒店/账号 session partition，未沉淀 workspaceId |
| 浏览器工具 | browser MCP：snapshot、find、click、type、evaluate、listen_request、screenshot、tab/account list | 计划 webRequest/CDP 监听 + RPA worker，工具协议未定 |
| 页面操作策略 | 要求先 snapshot/find，再 click；禁止 AI 猜业务 URL/路由跳转 | docs 已强调人工接管和监听，但未写 AI 页面操作策略 |
| 登录态用途 | PMS token/context + OTA channel session 都进入工具层 | 主要是 cookie/profile/storageState 给 RPA/HTTP 抓取复用 |
| 自动化位置 | Electron 主进程/内嵌浏览器通过 MCP 桥暴露工具，远程 so-agents 执行业务 | UI 浏览器负责登录/接管，Python RPA worker 负责自动任务 |
| 业务查询 | `pms_get_context` 后走 PMS 工具 / so-agents | 抓取后入 SQLite，再由 Agent 分析 |
| 渠道 session 管理 | 有 channelSync，按渠道 domain/入口维护和上报 session | 需要新增登录态健康检查、账号状态、session 诊断 |
| 失败诊断 | browser screenshot、network listener、tool progress、client logs | docs 计划截图/trace/HTML 快照，但未统一到 Agent 工具输出 |

### 方案形态差异

表面上都是：

```text
Electron + Chromium + 登录态保存 + 页面操作 + 网络监听
```

但订单来了的内嵌浏览器更像“AI 操作台的工具宿主”：

```text
模型
  -> MCP browser tools
  -> 内嵌 PMS/OTA 页面
  -> pms_get_context / execute_skill / so_cli
  -> 云 PMS / 远程业务 Agent
```

我们当前方案更像“RPA/抓取系统的登录态和接管入口”：

```text
用户可见 WebContentsView
  -> 建立 OTA 登录态 / 人工接管 / 页面查看
  -> profile/cookie/storageState
  -> Python RPA worker / HTTP 抓取
  -> SQLite
  -> Agent 分析和建议
```

因此，两者的核心差异是：

```text
订单来了：浏览器服务于云 PMS 业务工具闭环
我们：浏览器服务于外部 OTA/PMS 数据接入和本地自动化
```

### 对我们当前设计的修正建议

1. 不要只说 `platform/hotel/account session partition`，建议正式引入：

```text
workspaceId: ctrip / meituan / booking / airbnb / pms
accountId: 渠道账号或 PMS 账号
propertyId: 酒店/门店/网点
tabId: 运行中的浏览器页签
profileId: 本地浏览器 profile
```

2. 把浏览器能力抽象成工具协议，而不是只作为 Electron 内部 API：

```text
browser_snapshot
browser_find_text
browser_click
browser_type
browser_listen_request
browser_drain_listener
browser_take_screenshot
browser_list_tabs
browser_list_accounts
```

第一版不一定用 MCP，但接口边界可以按 MCP tool schema 设计，后续接 Agent 会顺很多。

3. 给 PMS/OTA 上下文定义一个标准 `context`：

```text
workspaceId
accountId
propertyId
baseUrl
cookieProfileId
storageStatePath
loginState
lastHealthCheckAt
capabilities
```

订单来了的 `pms_get_context` 里有 token、门店 ID、baseUrl。我们即使短期没有云 PMS，也要有类似的 `ota_get_context` / `channel_get_context`，否则 Agent 和 RPA 会到处传散乱参数。

4. 保留“UI 浏览器”和“执行浏览器”分离。

订单来了看起来把浏览器工具深度集成在桌面端，但我们第一版仍建议保留 docs 里的分工：

```text
WebContentsView：登录、验证码、人工接管、页面查看、低频操作
RPA Worker：定时抓取、批量任务、失败重试、trace、隔离崩溃
```

原因是我们没有订单来了那种云 PMS/远程业务 Agent 兜底，RPA 稳定性和诊断压力会更大。让 UI 浏览器承担大量自动任务，容易影响主窗口体验。

## 登录后本地状态观察

观察日期：2026-07-29

用户登录订单来了后，又做了一轮只读观察。未读取或记录 cookie/token/device auth 明文。

### 进程级工作区标记

运行中的 Electron renderer 进程里能看到类似参数：

```text
--ddll-workspace-id=tujia
--ddll-account-id=tujia-account-1
```

这说明它不只是把渠道状态存在前端页面里，而是把 `workspaceId/accountId` 作为 renderer 运行时上下文传给了 Electron 子进程。这个设计有几个好处：

- 进程、日志、诊断材料天然能关联到渠道和账号。
- browser tools 调用时可以定位目标渠道页签。
- 出问题时可以按 workspace/account 做隔离和恢复。

对我们启发：第一版就应该把浏览器页签和 RPA 任务都绑定到：

```text
workspaceId
accountId
propertyId
tabId
profileId
```

### workspace-state.prod.json

登录后本地文件：

```text
~/Library/Application Support/ddlldesk/workspace-state.prod.json
```

包含字段：

```text
lastActiveTabId
lastActiveAccountId
lastActiveChannelWorkspaceId
trayHintShown
workspaces
```

每个 workspace 下包含：

```text
activeAccountId
accounts[]
hiddenAccounts[]
```

每个 account 大致包含：

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

每个 tab 大致包含：

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

这个结构非常值得我们参考。它把“渠道入口、账号、页签、登录状态、展示信息、渠道特定状态”都放进一个本地持久化状态文件。

### 实际 workspace 列表

登录后的本地状态包含这些 workspace：

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
meituanMinsu
tujia
xiaozhu
muniao
xiaohongshuPro
xiaohongshuNormal
airbnb
traveloka
tiket
tripCom
```

其中部分 workspace 默认已有一个账号和主 tab；`airbnb/traveloka/tiket/tripCom` 在本次观察中还没有账号。

### 登录状态模型

观察到的 `loginState` 包括：

```text
unknown
logged_out
```

`loginStateSource` 包括：

```text
startup
display-fetch
xiaohongshu-normal
```

这说明它的登录状态不是单一字段，而是带来源的状态判断：

- `startup`：启动时根据初始化/页面状态判断。
- `display-fetch`：通过页面展示信息抓取判断。
- `xiaohongshu-normal`：渠道特定逻辑判断。

对我们启发：登录态健康检查应该包含：

```text
loginState
loginStateSource
loginStateUpdatedAt
healthCheckReason
```

不要只保存一个 `isLoggedIn=true/false`。

### Partition 设计

Electron profile 下出现独立 partition 目录，命名格式类似：

```text
Partitions/ddlldesk%3Aprod%3A<workspaceId>%3A<accountId>/
```

例如：

```text
ddlldesk:prod:pms:pms-default
ddlldesk:prod:ctrip:ctrip-account-1
ddlldesk:prod:meituan:meituan-account-1
ddlldesk:prod:tujia:tujia-account-1
```

每个 partition 下面有自己的：

```text
Cookies
Session Storage
Local Storage
IndexedDB
Code Cache
Service Worker
```

只统计 cookie host，不读取 cookie 值，能看到不同渠道确实分别落在各自 partition：

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

这比单纯“保存 cookie”更完整：它是按渠道账号隔离整个 Chromium storage。

对我们启发：建议采用类似 partition 命名：

```text
rms:prod:<workspaceId>:<accountId>
```

或者更严格一点：

```text
rms:<env>:<tenantId>:<workspaceId>:<accountId>
```

### 本地 bus / bridge

登录后本地文件：

```text
~/Library/Application Support/ddlldesk/bus-port.json
~/.smartorder/bridge.sock
```

`bus-port.json` 包含：

```text
pid
port
```

本次观察端口是一个本地 WebSocket 服务，普通 HTTP GET 返回：

```text
426 Upgrade Required
WebSocket upgrade required
```

`~/.smartorder/bridge.sock` 是 Unix socket，包内代码显示 browser MCP、app-capabilities MCP、execute_skill 都通过这个 bridge 转发到主进程。

这说明它有两条本地通信通道：

```text
Electron app internal bus: WebSocket
MCP/tools bridge: Unix socket
```

对我们启发：

- 主进程内部事件可以用本地 WS/IPC。
- Agent/tool 调用建议单独走受控 bridge。
- bridge 层要做工具白名单、超时、审批、日志和敏感信息脱敏。

对我们最直接的启发：

1. 可以直接采用 “browser MCP / app capabilities / business agent” 三层工具边界。
2. 本地订单中心需要先有 `workspaceId/accountId`，否则多渠道、多账号后很快乱。
3. 不要让 AI 直接改 URL 跳业务页面；订单来了明确要求页面内菜单跳转必须先 snapshot/find，再 click，避免猜路由。
4. 对库存/房价/渠道/房型等高风险查询，订单来了不鼓励底层 HTTP，而是要求走 PMS 上下文和受控业务工具。这点值得跟。
5. 跨店 fan-out 第一版可以先禁用，避免权限、幂等、失败部分成功、审计复杂度过早放大。

## 对我们产品的启发

1. 第一版如果没有官方渠道直连，不要把“实时防超售”作为强承诺。RPA/抓取链路天然有延迟和风控不确定性，应该定位为“经营分析 + 异常发现 + 半自动执行”。

2. 订单来了的关键用户价值是“订单来了自动进房态”，而不是“能看报表”。我们如果做桌面版，也需要一个本地订单中心，把新订单、取消、改期、待确认、冲突订单统一建模，而不是只保存原始抓取结果。

3. 建议补一个“订单事件模型”：

```text
channel_order_created
channel_order_modified
channel_order_cancelled
inventory_conflict_detected
rate_inventory_mismatch_detected
manual_review_required
action_confirmed
action_executed
action_verified
```

4. 建议补一个类似“订单盒子”的异常单隔离机制。可以叫 `order_exception_box` 或 `review_queue`，用于冲突单、疑似刷单、抓取不完整、渠道/PMS 状态不一致等场景。进入该队列的订单不直接触发自动改价/改库存，必须人工确认。

5. 如果后续要对标订单来了，需要拆成两条路线：

- 短期：桌面/RPA 方案，解决没有开放 API、商家已经在多个 OTA 后台运营的问题。
- 中长期：渠道直连/开放平台方案，逐步从“抓后台”升级为“接订单事件 + 同步价量态”。

## 可继续深挖的材料

- 订单来了官网 PMS 产品页：https://dingdandao.com/pms?hash=pmsPagePro
- Smart Order 中文官网：https://www.smartorder.ai/zh_cn/
- Smart Order 前台住宿管理：https://www.smartorder.ai/zh_cn/front-desk/
- Smart Order 度假民宿方案：https://www.smartorder.ai/zh_cn/vacation-rental-software/
- Smart Order 统一消息 inbox：https://www.smartorder.ai/zh_CN/unified-inbox
- Smart Order 订单盒子教程：https://www.smartorder.ai/resources/zh/support/ding-dan-he-zi/
- Channel Manager 行业解释：https://rms.mrhost.com.tw/cn/news/channel-manager
- 订单来了 AI 工作台新闻稿：https://henan.china.com/news/roll/2026/0625/062026_734913.html
- 订单来了 AI 操作系统新闻稿：https://k.sina.com.cn/article_7880068235_1d5b04c8b01902e2os.html?from=tech
