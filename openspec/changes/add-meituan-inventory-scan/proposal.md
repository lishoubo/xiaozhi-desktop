## Why

定时扫描当前只实装了携程，美团仍只有被动监听（用户改动才上报），用户在别处改价改房态、或美团自行变更时本应用收不到任何信号。美团三个读端点已由 RMS RPA 侧踩透并在生产跑过，desktop 侧可直接接入。

## What Changes

- 新增美团扫描取数实现：三步请求（`poiInfos` → `queryListAndTag` → `queryPriceInventoryStatusInfo`），产出价格与房态两类原始行
- 新增美团行→格子映射，两类格子落在各自的 ID 空间：价格挂售卖房型 `goodsId`，房态房量挂物理房型 `roomId`
- 新增美团自然读基线接线（`isReadEndpoint` / `onReadResponse`）——当前美团一格基线都没有，扫描没有打底
- **扫描目标枚举从「遍历凭证」扩展为「遍历凭证下已绑定的门店」**：美团一个账号挂多门店，且门店级 `partnerId` 只存在于 `ota_hotel.bind_extra`
- `ScanTarget` 增加渠道专有上下文字段，`InventoryScan.scan()` 签名随之调整
- registry 的 `scanFetcher` 参数类型从 `CtripScanFetcher` 泛化为渠道无关类型
- 扫描开关默认为美团开启一个渠道键（仍受总闸与酒店级开关约束）

## Capabilities

### New Capabilities
- `meituan-inventory-scan`: 美团价量态定时扫描的取数、映射与上报契约

### Modified Capabilities
- `ota-inventory-scan`: 「扫描按渠道账号逐个进行」改为按「账号 × 门店」枚举——渠道账号与门店不必然 1:1

## Impact

**desktop 新增**：`channels/meituan/inventory-scan.ts`、`channels/meituan/inventory-scan-payload.ts`、`inventory-snapshot/meituan-cells.ts`

**desktop 修改**：`channels/types.ts`（`InventoryScan` 签名）、`channels/registry.ts`、`channels/inventory-scan-dispatcher.ts`（`ScanTarget`）、`channels/meituan/amount-change-adapter.ts`（读端点钩子）、`composition/app-scope.ts`、`composition/window-scope.ts`、`app-config/defaults.ts`、`database/ota-hotel-repository.ts`（新增枚举方法）

**服务端**：需为 `(source=meituan, endpointId=<新端点标识>)` 写 Translator，否则上报静默沉淀为台账

**外部依赖**：美团三个读端点；`session.fetch` 从主进程发起美团请求的连通性**尚未验证**，是本次第一个任务
