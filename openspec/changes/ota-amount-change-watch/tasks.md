# tasks — OTA 价量态改动监控

> 方案见 `design.md`。顺序有依赖：契约 → 机制 → 适配器 → 装配 → 验证。
> 机制层（T2/T3）是本次架构风险所在，先写测试再实现。

---

## T1 共享契约

- [x] `shared/types/amount-change.ts` 🆕
  - `AmountSaveObserved`（`endpointId` / `requestBody` / `responseBody` / `pageUrl`）
  - `OtaAmountChangeReport`（`operationId` / `source` / `endpointId` / `otaHotelId` /
    `channelExtra` / `requestBody` / `observedAt`）
  - `OtaAmountChangeObserved = Omit<OtaAmountChangeReport, 'operationId' | 'observedAt'>`
  - 约束：零框架依赖（`shared/` 硬约束），不得 import `main/`
- [x] `channels/types.ts` ✏️ 加 `AmountChangeAdapter` 接口
  - `isWatchableUrl` / `saveEndpoints: ReadonlyMap<string, string>` / `isSuccessful` / `parse`
  - 与既有 `HotelProbe`、`LoginUrlMatcher` 并列，注释说明「唯一的渠道差异落点」

## T2 CDP 机制层（渠道无关）

- [x] `channels/amount-save-capture.ts` 🆕 `AmountSaveCapture`
  - 订阅四个 CDP 事件：`requestWillBeSent` / `responseReceived` / `loadingFinished` / `loadingFailed`
  - `pending: Map<requestId, PendingSave>`，requestId 来自 CDP，不自造
  - **坑 1**：`postData` 缺失且 `hasPostData` → `Network.getRequestPostData` 兜底
  - **坑 2**：每次 `set` 惰性清扫 `at` 超 60s 的项
  - **坑 3**：`pageUrl` 在 `requestWillBeSent` 当刻 `webContents.getURL()` 快照
  - 端点与成功判定**一律问 adapter**，本类不认识任何渠道
  - `attach()`：`isAttached()` 已被占用 → warn 并跳过；记 `attachedByUs`
  - `detach()`：仅在 `attachedByUs` 时真 detach（不掀酒店探测的桌）
- [x] 测试 `amount-save-capture.test.ts`
  - happy path：喂完整事件序列 → `onObserved` 收到正确 `AmountSaveObserved`
  - 边界：`postData` 缺失走 `getRequestPostData`
  - 边界：`loadingFailed` 后 pending 被清空（不泄漏）

## T3 分发器（渠道无关）

- [x] `channels/amount-change-watcher.ts` 🆕 `AmountChangeWatcher`
  - 订阅 `BrowserManager` 的 `tab:navigated` / `tab:closed`（**不新增** ota-tab 事件）
  - `captures: Map<tabId, AmountSaveCapture>`
  - 按 `channelId` 取 adapter，无 adapter 直接返回（携程/美团本期）
  - 进页 attach / 离页 detach / 同页 pushState 不重复 attach
  - `tab:closed` → detach + 清理
  - 上报走注入的窄回调 `report()`，**不得** import `services`/`gateway`（eslint 会拦）
- [x] 测试 `amount-change-watcher.test.ts`
  - happy path：进改价页 attach，离开 detach
  - 边界：无适配器的渠道不 attach
  - 边界：同页多次 `tab:navigated` 只 attach 一次

## T4 抖音适配器（本次唯一实装的渠道）

- [x] `channels/douyin/amount-change-adapter.ts` 🆕
  - `isWatchableUrl`：host `life.douyin.com` + path 含 `/p/travel-ari/hotel/price`
    （复用 `trusted-hotel-url.ts` 的 host 校验）
  - `saveEndpoints`：`save_amount_calendar` 一项（房态那行注释留位）
  - `isSuccessful`：`BaseResp.StatusCode === 0`
  - `parse`：从 pageUrl 取 `poi_id` / `groupid` / `lifeAccountId`；任一缺失 → `null`
    → `channelExtra: { merchantGroupId, lifeAccountId }`
- [x] `channels/registry.ts` ✏️
  - `ChannelAdapter` 加**可选** `amountChangeAdapter`
  - 只给抖音那项赋值
  - 加投影函数 `amountChangeAdapters()`（跳过没有适配器的渠道）
- [x] 测试 `amount-change-adapter.test.ts`
  - 用踩点 `修改价格.md` 的真实 URL + body 样本断言 `parse()` 输出
  - 边界：`isSuccessful` 对 `103810209 限价规则` 失败样本返回 false
  - 边界：pageUrl 缺 `poi_id` → `parse()` 返回 null

## T5 上报链路

- [x] `gateway/rms/types.ts` ✏️ 加 `RmsAmountChangeGateway` 接口
- [x] `gateway/rms/rms-amount-change-gateway-mock.ts` 🆕 `MockRmsAmountChangeGateway`
  - 只 `logger.info` 完整 payload，不发 HTTP
  - 注释写明真实实现照 `HttpRmsHotelGateway` 抄（`createRmsApiCall` + 认证 fetch）
- [x] `services/amount-change-report-service.ts` 🆕
  - 加 `operationId`（`randomUUID`）+ `observedAt`（ISO）→ 调 gateway
  - 失败重试 1 次后放弃并 warn（决策 14：不落盘）
  - **不依赖** `database/`（决策 11：不查本地绑定）

## T6 装配

- [x] `composition/window-scope.ts` ✏️
  - `new AmountChangeWatcher({ browserManager, adapters, logger, report })`
  - `report` 接到 `AmountChangeReportService`（窄回调跨过 channels→services 的禁止边界）
  - 确认生命周期挂在 window scope（watcher 依赖 `BrowserManager`，与 `LoginDetector` 同源）

## T7 验证

- [x] 定向测试：4 个新测试文件共 25 个用例全过
  （capture 6 / watcher 6 / 抖音适配器 10 / 上报服务 3）
- [x] `npm run lint` + `npm run check:types` —— 均通过，分层约束未被破
- [x] 完成态全量：`npm run test:unit` → 71 文件 402 用例全过，无回归
- [ ] **真机验证**（design.md §9 风险 2、3，必做）
  - 登录真实抖音账号 → 进改价页 → 改一次价 → 看日志有无完整上报 payload
  - **把改价页所有能触发保存的入口都点一遍**，确认是否有其他端点没被拦到
  - 确认一个 `lifeAccountId` 是否对应多个 `poi_id`
  - 故意改一个会被限价规则拒的价 → 确认**不上报**
- [ ] 把真机验证结果写进 `verification.md`

---

## 完成门禁

- 触及跨模块接口（新增 shared 契约 + channels 接口 + gateway 接口）
  → 按 CLAUDE.md 需同步 `openspec/specs/`；本次涉及 `desktop-main-layering`
  的 channels 层职责描述，实现后确认是否需要补 delta
- 真机验证未做完**不得**声称完成
