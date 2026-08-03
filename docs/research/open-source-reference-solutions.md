# RMS Desk 开源参考方案

调研日期：2026-07-29

## 总结

开源方案可以分三类看：

```text
1. 酒店 PMS / Booking Engine
2. Channel Manager / OTA 同步
3. 内嵌浏览器 / Agent 自动化工具层
```

结论：

- PMS/Booking Engine 有可参考项目，例如 QloApps、HotelDruid、Pesan PMS。
- 真正能生产级连接 Booking/Airbnb/Expedia/携程/美团等 OTA 的开源 Channel Manager 很少，通常只能看到 ICS 同步、demo、或商业 SaaS。
- 对我们最有价值的开源资产不是直接拿来做 PMS，而是浏览器自动化工具层：Playwright、Playwright MCP、Chrome DevTools MCP、browser-use、Stagehand。

## 酒店 PMS / Booking Engine

### QloApps

地址：

- https://github.com/Qloapps/QloApps
- https://qloapps.com/

定位：

```text
开源酒店管理 + 预订系统 + 酒店官网 / Booking Engine
```

技术栈：

```text
PHP + MySQL + Smarty / PrestaShop 生态痕迹
```

可参考点：

- 房型、房间、价格、订单、客户、前台管理的基础模型。
- Booking Engine 与 PMS 的结合方式。
- 酒店官网直订和后台订单管理。

不适合直接复用的点：

- 技术栈和我们计划的 Electron/React/Python/SQLite 不一致。
- 更像完整 PMS/官网系统，不是 OTA 经营副驾。
- Channel Manager 能力不是它的核心开源优势。

判断：

```text
适合参考 PMS 数据模型和订单/房态 UI，不建议作为我们底座。
```

### HotelDruid

地址：

- https://www.hoteldruid.com/

定位：

```text
免费开源酒店管理系统
```

公开功能包括房间、价格、自动分房、统计、网站页面、POS、文档、用户管理等，也提到 Booking Engine / Channel Manager add-on。

可参考点：

- 传统 PMS 的房态、价格期间、自动分房规则。
- 轻量自托管酒店管理系统的设计。

风险：

- UI 和技术路线偏老。
- Channel Manager 是否满足现代 OTA 双向实时同步，需要单独验证。

判断：

```text
适合参考传统 PMS 领域模型，不适合直接承接我们的桌面 Agent/RPA 路线。
```

### Pesan PMS

地址：

- https://github.com/pesanio/pesan-pms

定位：

```text
开源 PMS，覆盖酒店、民宿、别墅等住宿物业
```

公开 README 提到 dashboard、booking management、guest management、room/unit management、staff、reporting、multi-property，并把 Channel Manager integration 放在 roadmap。

可参考点：

- 现代 Web PMS 的模块划分。
- 多物业、预订、客人、房间、员工、报表的产品结构。

限制：

- 看起来仍在建设中。
- Channel Manager 是 roadmap，不是现成能力。

判断：

```text
适合看产品拆分，不适合依赖其 OTA 同步能力。
```

## Channel Manager / OTA 同步

### CM Free

地址：

- https://apartmamatevz.si/cmfree/

定位：

```text
自托管 booking calendar / reservation manager
```

公开能力偏 ICS：

```text
ICS import: Booking / Airbnb / Google
public calendar
local reservations and blocks
```

可参考点：

- 小业主场景下用 ICS 合并外部日历，减少冲突。
- 简单预订日历和本地 block 管理。

限制：

- ICS 不是完整 Channel Manager。
- 通常只适合同步可订日期，不适合复杂价型、库存、限制规则、订单状态、付款、取消、改期。

判断：

```text
适合做最低成本防撞单参考，不适合对标订单来了的渠道直连。
```

### Channex / OpenPMS 这类组合

OpenPMS 不是开源项目，但它公开提到通过 Channex 做 Booking.com、Airbnb、Expedia 和 400+ OTA 的双向同步。

地址：

- https://open-pms.com/

可参考点：

```text
PMS 自己不一定直连所有 OTA，可以接第三方 Channel Manager API。
```

对我们启发：

- 中长期如果要做渠道直连，不一定自己从 0 接 Booking/Airbnb/Expedia。
- 可以设计 `ChannelAdapter` 抽象，第一类 adapter 是 RPA，第二类 adapter 是开放 API，第三类 adapter 是 Channex 这类第三方 channel manager。

判断：

```text
不是开源底座，但商业架构值得参考。
```

## 浏览器自动化 / Agent 工具层

### Playwright

地址：

- https://github.com/microsoft/playwright

定位：

```text
浏览器测试和自动化框架，支持 Chromium / Firefox / WebKit
```

可参考点：

- storageState、trace、截图、网络监听、locator、自动等待。
- 很适合 RPA worker 中期迁移。

判断：

```text
我们 RPA worker 的核心候选。
```

### Playwright MCP

地址：

- https://github.com/microsoft/playwright-mcp

定位：

```text
给 LLM/Agent 用的 Playwright MCP server
```

它让模型通过结构化 accessibility snapshot 操作页面，不依赖截图视觉模型。

可参考点：

- `snapshot -> ref -> click/type` 的工具模型。
- 和订单来了 `browser_snapshot/browser_click/browser_type` 很像。
- 可以作为我们 browser tool schema 的参考。

判断：

```text
强烈建议参考工具协议；是否直接引入 MCP 取决于第一版 Agent 架构。
```

### Chrome DevTools MCP

地址：

- https://github.com/ChromeDevTools/chrome-devtools-mcp

定位：

```text
Chrome DevTools for coding agents
```

能力包括性能 trace、网络请求、控制台、截图、页面自动化和调试。

可参考点：

- CDP 能力如何暴露给 Agent。
- 网络监听、console、trace、截图这类诊断工具。

限制：

- 默认连接 Chrome remote debugging，对 Electron WebContentsView 需要做适配。
- remote debugging port 有安全风险，不能无脑打开。

判断：

```text
适合参考 CDP 工具设计，不建议第一版直接照搬安全模型。
```

### browser-use

地址：

- https://github.com/browser-use/browser-use

定位：

```text
开源 AI 浏览器自动化 Agent
```

它通过 Chromium/CDP 让 AI 执行网页任务，提供 Python API、CLI、browser profile、click/type/screenshot/state 等能力。

可参考点：

- 浏览器状态抽象。
- 自定义工具和 Agent loop。
- 持久化 browser profile。
- CLI 可用于快速验证 OTA 页面自动化。

限制：

- 通用网页 Agent，不是酒店 PMS/OTA 领域工具。
- 生产稳定性仍需要我们自己加任务幂等、审计、异常队列、账号健康检查。

判断：

```text
适合做实验和工具层参考，不建议直接把通用 Agent 当生产执行器。
```

### Stagehand

地址：

- https://www.stagehand.dev/
- https://github.com/browserbase/stagehand

定位：

```text
AI Browser Automation Framework
```

它强调在 Playwright/Selenium 这种确定性代码和黑盒 Agent 中间取平衡：用 `act/extract/observe` 做可控步骤，用 AI 处理页面变化。

可参考点：

- 已知流程用代码，易变页面用 AI。
- 让 AI action 可预览、可缓存、可回放。
- 对 OTA 后台这种 DOM 经常变化的场景很有参考价值。

判断：

```text
适合参考“确定性脚本 + AI 自修复”的设计。
```

## 推荐取舍

第一版不建议试图找一个开源 PMS/Channel Manager 直接改成我们的产品。原因：

- 酒店 PMS 开源项目和我们的桌面 Agent/RPA 路线差异大。
- 生产级 OTA Channel Manager 的核心在合作接口、映射、幂等、对账、SLA，不是代码开源后就能解决。
- 我们的优势是“不迁 PMS、不等官方接口、用本地浏览器/RPA 接现有后台”。

建议采用：

```text
领域模型参考：QloApps / HotelDruid / Pesan PMS
执行自动化底座：Playwright
Agent 浏览器工具协议：Playwright MCP / Chrome DevTools MCP
通用 AI 浏览器思路：browser-use / Stagehand
```

## 对我们架构的落地建议

### 1. Browser Tool Schema 参考 Playwright MCP

先定义一组内部工具，不一定第一版就上 MCP：

```text
browser_list_accounts
browser_list_tabs
browser_snapshot
browser_find_text
browser_click
browser_type
browser_listen_request
browser_drain_listener
browser_take_screenshot
browser_get_storage_state
```

### 2. RPA Worker 逐步向 Playwright 靠拢

短期保留 DrissionPage 资产；中期把新任务优先写成 Playwright：

```text
登录态建立：WebContentsView
storageState 导出：Electron / CDP
批量抓取：Playwright APIRequestContext 或 page.evaluate(fetch)
复杂操作：Playwright locator / trace
```

### 3. 不做开源 PMS 替换

QloApps/HotelDruid 可以参考字段，但不要引入其 PHP/MySQL 架构。我们更需要的是本地标准订单事件：

```text
channel_order_created
channel_order_modified
channel_order_cancelled
inventory_conflict_detected
rate_inventory_mismatch_detected
manual_review_required
action_executed
action_verified
```

### 4. Channel Manager 能力分阶段

```text
阶段 1：RPA/浏览器监听接入 OTA
阶段 2：对高价值渠道接官方 API
阶段 3：抽象 ChannelAdapter，允许接 Channex/第三方 Channel Manager
阶段 4：如果业务需要，再做自己的云 PMS/Channel Manager
```

## 候选优先级

| 优先级 | 项目 | 用途 |
| --- | --- | --- |
| P0 | Playwright | RPA worker 新任务、trace、网络、storageState |
| P0 | Playwright MCP | browser tool schema 参考 |
| P1 | Chrome DevTools MCP | CDP 诊断工具参考 |
| P1 | Stagehand | AI + 确定性自动化混合思路 |
| P1 | browser-use | 通用浏览器 Agent 实验 |
| P2 | QloApps | PMS/Booking Engine 数据模型参考 |
| P2 | HotelDruid | 传统 PMS 模型参考 |
| P2 | Pesan PMS | 现代 PMS 模块划分参考 |
| P3 | CM Free | ICS 防撞单参考 |
