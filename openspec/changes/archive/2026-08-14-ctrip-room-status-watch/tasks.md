# 携程房态监听 —— 任务清单

> 依据 `design.md`。顺序即依赖顺序：契约先行，类型检查会把所有遗漏点报出来。
> 测试粒度按 CLAUDE.md：迭代期只跑改动直接命中的测试文件，完成态跑一次全量。

## 1. 契约：changeType

- [x] 1.1 `shared/types/amount-change.ts` 新增 `OtaChangeType = 'price' | 'roomStatus'`，并在 `OtaAmountChangeReport` 加必填 `changeType` 字段
- [x] 1.2 给 `changeType` 写清注释：**意向标记而非精确分类**，`roomStatus` 含房态+房量，RMS 必须读 `changeRaw` 才知道实际改了什么；并说明它与 `endpointId` 是两个粒度、互不替代（见 design 决策 2）
- [x] 1.3 确认 `OtaAmountChangeObserved` 的 `Omit` 列表不含 `changeType`（应自动继承，适配器负责提供）

## 2. 契约：isSuccessful 加 endpointId 形参

- [x] 2.1 `channels/types.ts` 把 `isSuccessful(responseBody: string)` 改为 `isSuccessful(responseBody: string, endpointId: string)`，注释说明为何需要按端点分支（见 design 决策 6）
- [x] 2.2 `channels/amount-save-capture.ts` 调用处传入已算出的 `endpointId`（`saved.endpointId`）
- [x] 2.3 抖音、美团适配器补形参（实现体不变，忽略该参数）
- [x] 2.4 跑 `douyin-amount-change-adapter.test.ts`、`meituan-amount-change-adapter.test.ts`、`amount-save-capture.test.ts` 确认改价链路无回归

## 3. 三渠道补 changeType: 'price'

- [x] 3.1 抖音适配器 `parse` 返回体加 `changeType: 'price'`
- [x] 3.2 美团适配器 `parse` 的 report 分支加 `changeType: 'price'`（context 分支不涉及）
- [x] 3.3 携程适配器改价分支加 `changeType: 'price'`
- [x] 3.4 `npx tsc --noEmit` 确认无遗漏点

## 4. 携程房态：changeRaw 模型

- [x] 4.1 新建 `channels/ctrip/room-status-payload.ts`，定义 `CtripRoomStatusRaw` 类型骨架（见 design 决策 5）
- [x] 4.2 实现 `toCtripRoomStatusRaw`：顶层原样保留，`dateItemInfoDtoList[]` 逐项重建剔除 `holidyInfo`
- [x] 4.3 写文件头规格说明（RMS 侧对接读这份）：字段含义、`roomStatus` 的 `G`/`N` 语义、`weekDayIndex` 位串、门店定位方式、为何剔 `holidyInfo`
- [x] 4.4 新建 `tests/unit/main/ctrip-room-status-payload.test.ts`：用踩点原文验证 `holidyInfo` 被剔除、`roomStatus` 与其余字段原样保留

## 5. 携程适配器：房态端点

- [x] 5.1 `WATCHED_ENDPOINTS` 加 `['setbatchroombookablestatus', '/ebkovsroom/api/inventory/setbatchroombookablestatus']`，注释说明与两个改价端点互不为子串
- [x] 5.2 确认 `WATCH_PATHS` 无需改动（房态页即改价老模块日历页），并把这个结论写进注释免得后人重复排查
- [x] 5.3 `isSuccessful` 按 `endpointId` 分支：房态判 `code === 200 && returnCode === '200'`（⚠️ 该端点 `data` 为 `null`，**不能**走改价老模块那条查 `roomPriceSetResults` 的路径，否则每次成功都被判失败）；判失败时记 warn 并带响应体片段
- [x] 5.4 `parse` 按 `endpointId` 分流到房态分支：抽 `hotelRoomInfoDtoList[].hotelID` 作 `otaHotelId`（多店取第一家并记 info）、抽 `roomTypeID` 与 `originalRoomProductIds` 作定位依据、`changeType: 'roomStatus'`、`changeRaw` 走 `toCtripRoomStatusRaw`
- [x] 5.5 房态分支的丢弃路径：房型标识全空时记 warn 并返回 `null`
- [x] 5.6 更新适配器文件头：本渠道现在管三个端点（改价新老两套 + 房态），指明房态规格看 `room-status-payload.ts`

## 6. 上报链路

- [x] 6.1 `gateway/rms/rms-amount-change-gateway-http.ts` 请求体加 `changeType`
- [x] 6.2 同文件的两条日志加 `changeType`（真机排查时要能一眼看出这条是价还是量态）
- [x] 6.3 跑 `rms-amount-change-gateway-http.test.ts`、`amount-change-report-service.test.ts`

## 7. 测试

- [x] 7.1 `ctrip-amount-change-adapter.test.ts` 补房态用例：开房（`roomStatus: "G"`）与关房（`"N"`）各一条，验证 `changeType`、`endpointId`、`otaHotelId`、`changeRaw` 正确
- [x] 7.2 补一条房型标识全空 → 返回 `null` 的丢弃用例
- [x] 7.3 补一条端点分发用例：房态 URL 与两个改价 URL 各自匹配到正确的 `endpointId`，互不串味
- [x] 7.4 补 `isSuccessful` 的房态用例：用踩点那份 `data: null` 的真实成功响应断言为 `true`（**这条是回归护栏** —— 若有人日后把房态并回改价分支，它会立刻失败）
- [x] 7.5 既有改价用例补 `changeType: 'price'` 断言

## 8. 完成态验证

- [x] 8.1 `npx tsc --noEmit` + eslint 通过（重点看分层约束：`channels/` 未引入对 `services`/`database` 的依赖）
- [x] 8.2 跑一次 desktop 全量单测，如实记录结果
- [x] 8.3 真机验证：在携程日历页开房/关房各一次，确认拦到、判定成功、上报体的 `changeType` 与 `changeRaw` 符合预期
- [ ] 8.4 若能构造一次**被携程拒绝**的房态操作，抓失败响应样本回填踩点文档，据实收紧 `isSuccessful`（成功样本已于 2026-08-13 补齐）
- [x] 8.5 验证证据写入 `openspec/changes/ctrip-room-status-watch/verification.md`

## 9. 规范同步

- [ ] 9.1 本次触及跨模块契约（上报报文新增字段），验收后把 `specs/ota-amount-change-report/spec.md` 合并进 `openspec/specs/`（`openspec archive` 或手动合并 delta）
