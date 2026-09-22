## 1. 让比对交出旧值

- [x] 1.1 `snapshot-diff.ts`：新增 `SnapshotChange`（`latest` + `baseline`），`SnapshotDiff.changed` 由 `SnapshotCell[]` 改为 `SnapshotChange[]`；`added` 不变
- [x] 1.2 更新文件头注释：说明为什么 `changed` 要带基线（房量判据需比数值，hash 反解不出旧值），`added` 为什么不带
- [x] 1.3 改既有单测 `snapshot-diff.test.ts`（`diff.changed[i]` → `diff.changed[i].latest`），补一条「changed 带上了对应的基线格子」
- [x] 1.4 `scan-to-report.ts` 跟着改（`changed.map(cell => …)` → `changed.map(({ latest }) => …)`），本步只保证编译与行为不变，暂不接判据

## 2. 渠道房量口径

- [x] 2.1 新建 `inventory-snapshot/quantity-reading.ts`：定义 `QuantityReading`（`total: number | null`、`soldOut: boolean`）与 `QuantityReader`
- [x] 2.2 携程 reader：先判不限量（`freeSale === "T"` 或 `limitSale !== "T"` → `total=null`、`soldOut=false`），限量时 `total=totalQuantity`、`soldOut=canUsedQuantity===0`
- [x] 2.3 美团 reader：`limitType !== 1` → `total=null`、`soldOut=false`（哨兵值不参与比较）；`limitType===1` → `total=limitRemain+usedCount`、`soldOut=limitRemain===0`
- [x] 2.4 两个 reader 的字段缺失/类型不符一律返回 `total=null`，由判据按「变化」处理（失效朝多报方向）
- [x] 2.5 注释写清两个易错点：美团 `limitRemain+usedCount` 是**配额**而非物理房量（`remainCount+usedCount` 才是），携程 `hasInventory` 在限量时恒为 true、不能用来判售罄
- [x] 2.6 单测：用本地快照库的真实样本做 fixture，覆盖携程不限量 68 行场景、美团 `remainCount=0` 但配额有剩、美团哨兵 `limitType=2`

## 3. 上报判据

- [x] 3.1 新建 `inventory-snapshot/inventory-report-gate.ts`：输入一个 `SnapshotChange` + 渠道 reader，输出是否上报
- [x] 3.2 `itemType === 'price'` 直接放行（维持「变了就报」）
- [x] 3.3 房态字段变化直接放行（携程 `roomStatus`；美团 `roomStatus` + `invSwitch`）
- [x] 3.4 房量判据：`total` 新旧不等 → 报；`latest.soldOut && !baseline.soldOut` → 报；其余不报
- [x] 3.5 单测：卖出一间不报、改配额报、最后一间售出报、连续售罄只报首轮、售罄→恢复→再售罄报两次、房态变化恒报

## 4. 接线

- [x] 4.1 `scan-to-report.ts`：`changed` 经 gate 过滤后再组上报体；`added` 仍只写基线不上报
- [x] 4.2 装配层按渠道注册 reader（与 `mappers`/`reportBuilders` 同一处，渠道没注册时按「变了就报」兜底）
- [x] 4.3 扫描日志补一个 `reported` 计数（与既有 `compared`/`changed` 并列），使「变了多少 / 报了多少」在日志里可对账
- [x] 4.4 定向跑受影响单测（`snapshot-diff` / `scan-to-report` / 新增两个模块），不跑全量

## 5. 文档

- [x] 5.1 写 `服务端需求.md`：两渠道房量计算口径、上报触发条件、与既有两份的关系（只收窄触发条件，报文结构不变）
- [x] 5.2 订正 `meituan-cells.ts` 中「`remainCount` 与 `usedCount` 一起才能还原出总量」的表述，注明那是物理房量、配额是 `limitRemain+usedCount`
- [x] 5.3 订正 `channels/meituan/inventory-readback-payload.ts:84` 已被 §4.1 取代的旧结论（仍写着「`limitRemain` 是用户设置的房量」）
- [x] 5.4 补记本地库实测到的未文档化取值：`limitRemain=1002` 哨兵、`roomStatus=100`、`fullRoomCode=4`

## 6. 验证与收尾

- [x] 6.1 真机跑一轮扫描：确认有订单的房型不再每轮上报 —— ✅ 19:06 与 19:51 各一次 `suppressed: 1`（预留房量抖动被滤掉）
- [x] 6.2 真机在渠道后台改一次配额：确认下一轮能报出 —— ✅ 1569052074 房量 2→3，精确报 3 个格子（无早/单早/双早）× 1 天
- [ ] 6.3 真机制造一次「最后一间售出」：确认报一次、后续轮次不再重复报 —— ⏳ 未造出真售罄样本
- [x] 6.4 上线首轮确认无全窗口误报（`HASH_FIELDS` 未动的验证） —— ✅ 加 room_name 后首轮无误报
- [x] 6.5 把验证结果写进 `verification.md`
- [ ] 6.6 判断是否触发完成门禁（本次改的是上报触发条件，属跨模块接口语义变更）→ 同步 `openspec/specs/` 对应 capability

## 7. 本轮追加（基线新鲜度 / 日志 / 房型名）

- [x] 7.1 快照表加 `room_name` 列（一列，不配对两个 ID —— 两个 ID 恒有且仅有一个非空）
- [x] 7.2 携程按 roomTypeID 从房型清单贴名字；美团房态取 `roomName`、价格取 `goodsName`
- [x] 7.3 dev 日志落到环境目录（`setAppLogsPath()` 无参时用 bundle 名，dev 下是 `Electron`）
- [x] 7.4 扫描链路加 traceId，service 层复用为 `operationId`
- [x] 7.5 比对日志按 itemType 拆开 + `suppressed` 计数
- [x] 7.6 RMS 回 `items: 0`（收下即丢弃）时打 warn 而非 info
- [x] 7.7 基线太旧时只写不报（`baselineFreshnessMs`，默认 1 小时，可配）
- [x] 7.8 真机验证 7.1~7.7（见 `verification.md`）
- [ ] 7.9 观测 `reason: 'stale'`（需运行期间断档 > 1 小时）
