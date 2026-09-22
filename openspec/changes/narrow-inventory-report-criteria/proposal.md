## Why

定时扫描当前的上报判据是「`contentHash` 里任一字段变了就报」，而酒店**有订单时房量本来就会变**
（卖出一间 → 已售 +1、剩余 −1）。真机观察到房量上报过于频繁，绝大多数是这类正常销售噪音，
不是需要跟进的渠道事实。

## What Changes

- 房态与房量**拆成两条独立判据**（当前是一个 `contentHash` 混判）：
  - **房态**：有改变就报 —— **与现状一致，不动**
  - **房量**：仅在 ① 总房量变化 或 ② 可售房量**从非 0 变为 0** 时上报
- 「可售为 0」只报**跃迁**，不报持续状态 —— 否则售罄的格子每轮都会重复上报
- `diffSnapshots` 返回值带上**基线格子**，让上报判断能比对新旧值（当前只比 hash，拿不到旧值）
- 新增给服务端的对接文档，说明两个渠道的房量计算口径与上报触发条件
- **不改** `HASH_FIELDS` 及其顺序 —— 顺序即 hash 拼接顺序，改动会让全部既有基线失效，
  下一轮扫描把整个窗口判成变更

## Capabilities

### New Capabilities

- `ota-inventory-scan-report`: 定时扫描的差异**上报判据** —— 哪些渠道侧变化值得上报、
  两个渠道的「总房量」与「可售房量」分别怎么算、跃迁与持续状态如何区分

### Modified Capabilities

<!-- 无。`ota-amount-change-report` 描述的是被动观测（拦写请求）那条链路，本次不改它的任何要求。 -->

## Impact

| 影响面 | 说明 |
|---|---|
| `inventory-snapshot/snapshot-diff.ts` | `SnapshotDiff.changed` 由 `SnapshotCell[]` 改为带基线的结构 |
| `inventory-snapshot/scan-to-report.ts` | 接入房量判据；`changed` 过滤后才组上报体 |
| 新增判据模块 | 渠道相关的房量口径（携程 / 美团各一份映射） |
| `ota_inventory_snapshot` 表 | **不变**（不加列、不改 hash、无 migration） |
| 服务端 | 上报量显著下降；**不改报文结构**，仅触发条件收窄 |
| 既有基线 | **不失效**（`HASH_FIELDS` 与顺序均不动） |
