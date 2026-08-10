## Why

`OtaAccount`（酒店探测结果）目前和 `OtaCredential`（登录身份）耦合在
`DiscoverAndCreate` 同一次调用里写入，且渠道探测函数把"读身份"和"读酒店"焊死在
一起（抖音场景下"读酒店"还要独占 CDP debugger），导致账号身份处理和酒店信息探测
无法独立演进、独立触发。拆分后 `ota-credential` 只负责登录判定和身份归并这一件
通用能力，酒店探测收敛成一个独立订阅广播事件的 Feature，为后续新增其他"登录后
业务场景"提供可复制的接入模式（同一广播总线、各自独立判断、互不阻塞）。

## What Changes

- 新增 `main/browser/tab-event-bus.ts`：`BrowserManager` 每次标签页导航
  （`did-navigate`/`did-navigate-in-page`）在原有 `checkUrlPastLogin` 逻辑之外，
  并行广播原始导航事件（tabId/partitionName/channel/url/webContents），不改动
  现有登录触发链路
- 新增 `main/features/ota-hotel-prob/`：`OtaHotelProbFeature` 订阅广播事件，自
  行判断页面是否可读取酒店列表、自行判断该 credential 是否已探测过，未探测则按
  渠道分发到对应实现（`ota/ctrip/hotel-prob.ts`、`ota/douyin/hotel-prob.ts`、
  `ota/meituan/hotel-prob.ts`）
- 新增数据表 `ota_hotel_prob`（字段结构对齐现有 `ota_account`：id / credential_id
  / channel / ota_hotel_id / ota_hotel_name / bind_extra / discovered_at），新
  `OtaHotelProbRepository` 接口与 SQLite 实现
- 抖音/美团探测函数按职责拆分：`ota-credential` 侧只保留"读身份"部分；"读酒店
  列表"（抖音含点击门店管理菜单+CDP抓包）整体移入 `ota-hotel-prob` 对应渠道实现
- 携程探测不拆（身份是从酒店 DOM 顺带解析出的，无法独立于酒店数据判定身份）：
  `ota-hotel-prob` 侧携程实现直接消费 `ota-credential` 侧已经拿到的探测结果，不
  重复操作页面
- 抽取 `main/features/common/ota/trusted-hotel-url.ts`：三渠道重复的"HTTPS +
  固定域名"URL 可信性校验逻辑收敛成一个通用函数，供两个 Feature 各自渠道实现
  复用
- 目录重组：`main/account-discovery/` 整体移入 `main/features/ota-credential/`；
  `main/ota/meituan/login-url-matcher.ts` 移入
  `main/features/ota-credential/ota/meituan/`，与携程/抖音位置对齐
- **BREAKING**（仅限桌面应用内部实现，无对外契约变更）：`main/ota/{ctrip,douyin,
  meituan}/discover-*.ts` 内部实现被拆分/移动，原文件不再存在，`DiscoverAndCreate`
  不再直接写 `OtaAccount` 记录（原 `ota_account` 表和 `OtaAccountRepository` 保
  留但停止新增写入，见 design.md 迁移策略）

## Capabilities

### New Capabilities
- `ota-hotel-discovery`: 登录成功后独立探测并持久化 OTA 酒店列表信息的能力，与
  账号身份归并解耦，通过标签页导航事件总线触发

### Modified Capabilities
- `local-ota-credentials`: `OtaCredential` 归并规则不变，但不再在同一次调用里
  级联写入酒店信息；`OtaAccount` 表进入停止写入状态，酒店信息新写入路径改为
  `ota_hotel_prob` 表（新 capability `ota-hotel-discovery` 覆盖）

## Impact

- **Affected code**：`main/browser/browser-manager.ts`、
  `main/account-discovery/*`（整体移动）、`main/ota/*`（拆分/移动）、
  `main/features/ota-credential/*`（新增内容）、`main/features/ota-hotel-prob/*`
  （新增）、`main/features/common/ota/*`（新增）、`main/database/`（新表迁移）、
  `main/application.ts`（组装新 Feature 与 TabEventBus）
- **不受影响**：renderer 侧无任何界面消费 `OtaAccount`/未来 `ota_hotel_prob` 数
  据（已在上一次 IPC 收敛改动中确认），本次不涉及 IPC/preload 改动
- **风险**：`BrowserManager` 需要新增广播逻辑，属于触碰通用容器层的改动，需要
  验证不影响现有登录链路（老链路完全不改代码路径，只是并行新增一行广播调用）
