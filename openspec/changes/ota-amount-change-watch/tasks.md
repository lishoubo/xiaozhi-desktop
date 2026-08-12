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

## T4 抖音适配器（第一个实装的渠道）

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

## T8 携程适配器（2026-08-11，踩点 `docs/踩点/携程/改价.md`）

> 机制层与 `AmountChangeAdapter` 接口**一行未改** —— 新增只有一个适配器文件 + registry 一行。

- [x] `channels/ctrip/amount-change-adapter.ts` 🆕
  - `isWatchableUrl`：host `ebooking.ctrip.com` + path 以 `/ebkovsroom/inventory` 开头
    （复用 `trusted-hotel-url.ts`）
  - `saveEndpoints`：`batchsetroomprice` 一项
  - `isSuccessful`：外层 `code === 200` **且** `data.roomPriceSetResults` 非空且每条
    `resultCode === 0`（保守口径，部分成功也判失败）
  - `parse`：从**请求体**取 `roomPriceInfoList[].hotelID`（携程与抖音相反，门店 ID 明写在 body 里）；
    一个都取不到 → `null`（硬错误）
    → `otaHotelId` 取第一家，`channelExtra: { hotelIds, roomTypeIds }`
  - `roomTypeIds` 同时收 `roomTypeID` 与 `refRoomIDs`（联动房型，踩点响应的 `roomTypeList` 证实）
- [x] `channels/registry.ts` ✏️ 给携程那项赋 `amountChangeAdapter`
- [x] 测试 `ctrip-amount-change-adapter.test.ts` —— 10 个用例，样本全部取自真实踩点
  - happy path：`parse()` 输出门店/房型/透传请求体
  - 边界：跨多家门店 → `otaHotelId` 取第一家 + `hotelIds` 全量 + 记 info
  - 边界：`isSuccessful` 对「部分 `resultCode` 非 0」返回 false
  - 边界：请求体无 `hotelID` → `parse()` 返回 null
- [x] `npm run lint` + `check:types` + `test:unit`（72 文件 420 用例全过，无回归）
- [ ] **真机验证**（design.md §12.4，必做）
  - 登录真实携程 ebooking → 房价日历页改一次价 → 看日志有无完整上报 payload
  - **把改价页所有能触发保存的入口都点一遍**，确认是否有其他端点没被拦到
  - 确认 referer 是否稳定为 `/ebkovsroom/inventory/*`（`pageUrl` 的来源）
  - 确认是否存在「前端先 check 再 save」的双请求（抖音有，携程踩点未见）
  - 故意改一个会被佣金/限价规则拒的价 → 确认**不上报**

## T9 美团适配器（2026-08-11，踩点 `docs/踩点/美团/改价踩点.md`）

> 机制层与 `AmountChangeAdapter` 接口再次**一行未改** —— 三个渠道全部接完，
> 印证 design.md「适配器是唯一渠道差异落点」的判断成立。

- [x] `channels/meituan/amount-change-adapter.ts` 🆕
  - `isWatchableUrl`：host `me.meituan.com` + path 以 `/ebooking/merchant/product` 开头
    （只到 `product` 不到 `batch-price`：漏认路由的代价是整条监听被 detach，携程已踩过）
  - `watchedEndpoints`：`updatePriceV2`（`/api/gw/v1/product/price/updatePriceV2`）；
    2026-08-12 加入试算端点 `calcPriceV2`，见 T9.2
  - `isSuccessful`：`code === 10000` **且** `success === true`（保守口径，两个都要求为真）
  - `parse`：从**请求体顶层**取 `poiId`（三渠道里最直接的一个，单值且与契约天然对齐）；
    房型取 `goodsList[].goodsBaseInfo.goodsId`（不取历史遗留的 `preGoodsId`）；
    一个 `goodsId` 都取不到 → `null`（硬错误）；缺 `poiId` 不阻断但记 warn
  - 请求体**原样透传**：噪音字段（`mtgsig` 等风控参数）都在 query string 上不在 body 里，
    无需像携程那样剔除
- [x] `channels/registry.ts` ✏️ 给美团那项赋 `amountChangeAdapter`，
  并订正 `amountChangeAdapter` / `amountChangeAdapters()` 上「美团尚无踩点」的过时注释
- [x] 测试 `meituan-amount-change-adapter.test.ts` —— 12 个用例，样本全部取自真实踩点
- [x] `lint` + `check:types` + 桌面全量 `test:unit`（73 文件 446 用例全过，无回归）

### T9.1 真机前的日志订正（写代码时发现，非踩点内容）

接完美团后复查日志链路，发现一个**会让真机验证白跑**的缺陷 —— `AmountSaveCapture.attach()`
在 debugger 被酒店探测占用时只 warn 后 `return`，**不抛错**，于是 watcher 照打
`Amount change watching started`。日志上是「已启动 + 改价没反应」，与携程那次
「监听被悄悄停掉」同一类失效。美团把这个概率放大了：`WATCH_PATH` 取宽前缀
`/ebooking/merchant/product`，与美团绑定/探测流程共用 `me.meituan.com` 的同一个 tab。

- [x] `attach()` 改为返回 `boolean`（true = 真的挂上了），注释写明「不看返回值就会误判」
- [x] watcher 据此分流：没挂上 → 记 `not watching, debugger is busy`，**不打成功日志**
- [x] 🐛 **同时修掉一个真实 bug**：原代码失败时不撤销 `captures` 登记，那条死 capture 会让
  `captures.has()` 永远判定「已在监听」，探测结束让出 debugger 后**再也挂不上**，该 tab
  永久拦不到改价。现在失败即 `captures.delete()`
- [x] 补 3 个用例（capture 返回值 2 个 + watcher 占用/恢复 2 个），并**验证过它们在旧代码上
  确实失败**（2 failed）——否则锁不住回归
- [x] 订正 `amount-change-watcher.ts` 与其测试里 3 处「本期只有抖音／携程美团尚无踩点」的过时注释
- [x] **真机验证（部分）** —— 2026-08-11，拦到 10+ 次改价，`poiId`/`goodsId` 解析全对，
  `operateType` 六种取值全部实测确认。产出两份文档：
  - `meituan-payload-spec.md` —— 上报体数据规格（给 RMS 侧）
  - `meituan-next-steps.md` —— **现状、缺口与明天的顺序，继续做之前先读这份**
### T9.2 两个必修问题（2026-08-12 已实装，方案见 `meituan-next-steps.md`）

- [x] **`createFlag` 重复上报**：美团改价是三段式（算价 → 预检 `false` → 确认 `true`），
      ②③同端点、请求体 60 字段只差 `createFlag`、响应一样。原先两次都上报，
      `operationId` 不同幂等挡不住，且②用户可能点取消 → 脏数据。
      修法：`parse()` 里 `createFlag !== true` 返回 `null` + info 日志
  - 「弹窗是否必现」**不必先验** —— 按字段值分流，走两段与只发一次都正确
- [x] **相对操作算不出最终价**：拦 `calcPriceV2`，把最近一次的请求条件 + 试算结果
      （`unifiedDatePriceInfos` / `priceInfos`，**不取** `realPriceInfos` —— 它的周次档
      与请求对不上）附在提交那条上报的 `priceContext` 里
  - `AmountChangeAdapter.saveEndpoints` → `watchedEndpoints`（拦的不都是保存了）
  - `parse(observed, context)` 返回 `report` / `context` / `null` 三态 ——
    **分流由适配器表达，机制层不认识具体端点**，渠道知识不下沉
  - 上下文状态放 `AmountSaveCapture`（每 tab 一个、`detach()` 即作废），
    适配器保持无状态（三渠道共用一份实例）
  - 契约加 `priceContext: JsonObject | null`（必填可空，新渠道漏填编译期报错）
  - `channelExtra` 方案作废 —— 该字段早已从契约删除（commit 6560706）
- [x] **真机验证通过**（2026-08-12）：拦到 `calcPriceV2`、预检被挡、一次改价只上报一条、
      改前 189.66 → 改后 190.66 可还原

### T9.3 上报形状定稿：单字段 `changeRaw` + 渠道 payload 模型（2026-08-12）

真机跑通后复盘发现主次反了 —— 当时把试算塞在 `priceContext` 里当配角，而它才是唯一
有用的东西。三轮讨论后定稿（推翻了 T9.2 的形状）：

- [x] **契约收成一个内容字段** `changeRaw: JsonObject`，删掉 `requestBody` / `responseBody`
  - 响应体不再上报 —— 渠道认没认已由 `isSuccessful` 判过，判失败的根本走不到上报
  - `priceContext` 撤销（它是上一版的产物）
- [x] **美团发试算结果，提交体一个字节都不发**
  - `endpointId` / `endpointUrl` 都改为指向 `calcPriceV2`
  - 提交体只有相对操作，而 **RMS 侧没有美团的数据**，既算不出绝对价也无从校验 → 死信息
  - 裁剪：信封层（`code`/`error`/`traceId`/`success`）、试算请求体整份（量纲是「元」，
    与响应的「分」不一致且冗余）、`realPriceInfos`、`goodsBaseInfo` 的 25 个静态字段
  - 实测 2074 → 827 chars
- [x] **各渠道建 `amount-change-payload.ts`**，RMS 对接读这几份
  - `channels/meituan/amount-change-payload.ts` —— 类型 + 裁剪 + 两种日期形状的归一化骨架
  - `channels/ctrip/amount-change-payload.ts` —— 两套模块的联合类型 + 噪音剔除
  - 抖音不建（原样透传，无个性化）
- [x] **mock 网关瘦身** 248 → 127 行，只留公共字段表 + 分派表，渠道细节指向上面两份
- [x] 测试：新增两个 payload 测试文件（11 用例），适配器测试去掉重复的裁剪覆盖
- [x] `lint` + `check:types` + 桌面全量 `test:unit`（**75 文件 472 用例全过**，无回归）
- [ ] 真机复验（形状大改后需重跑一遍 T9.2 那四项）
- [ ] **仍欠的真机项**
  - [ ] **把改价页所有能触发保存的入口都点一遍**，确认 `updatePriceV2` 之外有无其他保存端点
  - [ ] 故意改一个会被限价规则拒的价 → 确认**不上报**，并补记真实失败响应样本
        （当前 `isSuccessful` 的失败分支是照成功样本推断的，**风险最高**）

---

## 完成门禁

- 触及跨模块接口（新增 shared 契约 + channels 接口 + gateway 接口）
  → 按 CLAUDE.md 需同步 `openspec/specs/`；本次涉及 `desktop-main-layering`
  的 channels 层职责描述，实现后确认是否需要补 delta
- 真机验证未做完**不得**声称完成
