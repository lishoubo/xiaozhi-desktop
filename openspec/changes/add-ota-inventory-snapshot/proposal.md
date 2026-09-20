## Why

既有链路全部是**被动监听**（用户在我们 app 里操作 → CDP 旁听 → 上报），前提是变更必然经过
我们。用户在其他浏览器操作、或渠道自行关房（订满、活动到期）时无任何写请求，必然漏报。
主动对账需要一份「渠道当前是什么」的本地基线 —— 本 change 只建这份基线与它的写入链路，
定时扫描与差异上报在 `add-ota-inventory-scan`（Change B）。

背景、模块划分与已定结论见 `docs/arch/2026-09-20-ota-inventory-snapshot-and-scan.md`。

## What Changes

- 新增 `ota_inventory_snapshot` 表（migration v9）与其 repository，按
  (渠道, 酒店, 房型, 类型, 日期) 存裁剪后的渠道原始 cell
- 新增 `main/inventory-snapshot/`：写入队列（投递即返回）与比对纯函数
- 新增**自然读拦截**机制层：旁听渠道页面自己发出的价量态**读**请求，写入快照
- 既有**回读**成功后同步写入快照（复用已抽取的 cells，不重复取数）
- `app-config` 新增 `inventoryScan` 配置组，预留分酒店覆盖与多时间段窗口的形状
- eslint 新增一条分层禁令：`channels/` 不得 import `inventory-snapshot/`

不含：定时调度、差异上报、`net.fetch` 取数（均属 Change B）。

## Capabilities

### New Capabilities
- `ota-inventory-snapshot`: 渠道价量态本地基线快照的存储模型与写入链路 —— 存什么粒度、
  三条写入路径各自的触发与去重、`ota_hotel_id` 的归一口径、写入隔离与阻塞约束

### Modified Capabilities
<!-- 无。既有 ota-amount-change-report 的上报契约本次不变（新 endpointId 在 Change B 引入）。 -->

## Impact

| 范畴 | 影响 |
|---|---|
| 存储 | `database/application-database.ts` 加 migration v9；新增 repository |
| 新目录 | `main/inventory-snapshot/` |
| `channels/` | 新增自然读拦截机制层；携程新增 cells 抽取（与回读共用） |
| 既有回读 | `InventoryReadbackDispatcher` 增加一个 persist 窄回调；**上报链路不变** |
| 装配 | `app-scope` 新增队列与 repository；`window-scope` 接投递方 |
| lint | `.eslintrc.json` 新增一条 `no-restricted-paths` |
| 依赖 | 无新增第三方依赖（better-sqlite3 已在用） |
