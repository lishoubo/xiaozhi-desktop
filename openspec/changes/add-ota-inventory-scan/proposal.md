## Why

`add-ota-inventory-snapshot`（Change A）已建立本地基线，但基线的两条写入路径都要用户在操作
（改完回读、翻页面旁听）。用户在其他浏览器改价、或渠道自行关房（订满、活动到期）时，
本应用不会收到任何信号 —— 这正是立项要解决的漏报场景。需要一条主动、周期性的对账链路：
定时取回渠道当前状态，与基线逐格比对，有差异即上报。

背景与模块划分见 `docs/arch/2026-09-20-ota-inventory-snapshot-and-scan.md`。

## What Changes

- 新增定时扫描调度：fixed-delay（跑完歇 N 分钟再开下一轮，非固定频率）
- 新增取数层：按凭证的 `partitionName` 用 `session.fetch` 发请求 —— **不依赖标签页**
- 遍历 `ota_credential` 逐个账号扫描（`listByChannel` 已存在）
- 差异上报：复用既有上报服务，新增 `endpointId`；**不带旧值**
- 首次扫描只建基线不上报（库里无基线的格子只写不报）
- 扫描窗口与自然读范围对齐（Change A 遗留的 11.2）
- cookie 失效 / 403 走既有 GlitchTip 上报；**面向用户的重登引导不在本次**

## Capabilities

### New Capabilities
- `ota-inventory-scan`: 周期性主动对账 —— 扫描范围与频率、取数的会话来源、差异判定与
  上报口径、失效处置

### Modified Capabilities
- `ota-inventory-snapshot`: 新增 `scan` 来源的写入路径；扫描写入的格子与既有两条路径
  共用同一张基线

## Impact

| 范畴 | 影响 |
|---|---|
| 新增 | `channels/inventory-scan-dispatcher.ts`（第六种触发模型）；各渠道取数实现 |
| 复用 | `SnapshotWriteQueue` / `snapshot-diff` / repository（Change A 已建，本次才接线） |
| 上报 | 复用 `AmountChangeReportService`，无新增 gateway |
| 配置 | `inventoryScan` 加 `idleMs` 与空闲判据；`window` 值对齐 |
| 装配 | app-scope（调度跨窗口）；window-scope 只接投递方 |
| 依赖 | 无新增第三方依赖 |
