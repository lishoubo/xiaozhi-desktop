## Why

携程有三个菜单都能改价量态，desktop 当前只完整覆盖了其中一个。「统一加减价」和整个「房态房量菜单」的操作**静默漏报**——日志上与「用户根本没改」完全一致，RMS 收不到任何信号。

## What Changes

- 补 `setUniformRCRoomPrice`（房价维护菜单·统一加减价）：仅缺端点常量一行，页面已在监听范围内，响应形状与 `setRCRoomPrice` 同构。
- 修既有缺陷：改价新模块只收 `roomPriceInfos[].roomProductId`，漏了 `relationRoomProducts[].roomProductId`（联动房型，与 `excludedRelationRoomProductIds` 语义相反）。影响 `setRCRoomPrice` 与新增的 `setUniformRCRoomPrice`。
- 接 `batchUpdateRoomStatusAndQuantity`（房态房量菜单）：放开 `/rateplan/batchSetRoomStatusAndQuantity` 页面前缀，新增一份 `changeRaw` 规格，成功判定按端点加分支。该端点与老房态端点**零字段同名**。
- 明确「门店 ID 缺失是正常情况」：新端点请求体里没有 `hotelID`，`otaHotelId` 留空串，由 RMS 按 `roomProductId` 反查兜底，desktop 不做任何补齐。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `ota-amount-change-report`：新增「同一渠道的同类操作可能分散在多个页面与端点」的覆盖完整性要求；明确上报体 `otaHotelId` 允许为空且下游负责反查；补充「量态端点的请求体形状可能在同一渠道内互不兼容」的解读约定。

## Impact

- `apps/desktop/src/main/channels/ctrip/amount-change-adapter.ts`：`WATCH_PATHS`、`WATCHED_ENDPOINTS`、`isSuccessful` 分支、`parse` 分流。
- `apps/desktop/src/main/channels/ctrip/amount-change-payload.ts`：联动房型收集。
- `apps/desktop/src/main/channels/ctrip/room-status-quantity-payload.ts`：**新增**。
- 单测：`ctrip-amount-change-adapter.test.ts`、`ctrip-amount-change-payload.test.ts`、新增房态房量 payload 测试。
- **RMS 侧**：需能处理新端点的 `changeRaw` 形状，以及 `otaHotelId` 为空的上报。
- **阻塞项**：第三块实现前需补三处踩点样本（见 design.md §待确认）。
