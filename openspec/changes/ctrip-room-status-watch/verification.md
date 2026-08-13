# 携程房态监听 —— 验证证据

> 记录时间：2026-08-13。自动化验证 + **真机验证均已通过**。

## 自动化验证

| 项 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npm run check:types`（`tsc --noEmit -p tsconfig.node.json`） | ✅ 通过，无输出 |
| Lint（含分层约束） | `npm run lint`（`eslint --ext .ts,.tsx,.mts .`） | ✅ 通过，无输出 |
| 单测（全量） | `npm run test:unit` | ✅ **79 个文件 / 505 tests passed** |

分层约束重点核对：`channels/` 未引入对 `services/`、`database/`、`electron` 的依赖 —— 新增的
`room-status-payload.ts` 只 import `shared/types/json`，eslint 的边界规则未报错。

### 本次改动直接命中的测试

```
✓ ctrip-amount-change-adapter.test.ts     31 tests   （新增房态 11 条）
✓ ctrip-room-status-payload.test.ts        5 tests   （🆕 全新文件）
✓ ctrip-amount-change-payload.test.ts      3 tests
✓ douyin-amount-change-adapter.test.ts    12 tests
✓ meituan-amount-change-adapter.test.ts   23 tests
✓ amount-save-capture.test.ts             13 tests
✓ amount-change-watcher.test.ts            8 tests
✓ amount-change-report-service.test.ts     7 tests
✓ rms-amount-change-gateway-http.test.ts   8 tests   （新增 changeType 断言 1 条）
                                          ─────────
                                          110 tests
```

### 两条关键回归护栏

1. **`data: null` 的房态响应判为成功** —— 用踩点真实响应断言。若有人日后把房态并回改价
   老模块那条查 `roomPriceSetResults` 的路径，这条立刻失败。没有它，失效方式是**静默漏报**。
2. **同一份响应按 `batchsetroomprice` 判时为 false** —— 反向证明 `endpointId` 分支确实生效，
   而不是碰巧两条路径都返回 true。

### 过程中被测试挡下的真实问题

- `douyin-amount-change-adapter.test.ts` 的 `toEqual` 全等断言捕获了漏加 `changeType` 的
  上报体（把 `changeType` 设为**必填**字段的用意正在于此：类型检查 + 全等断言双重兜底）。
- `npx tsc --noEmit` 捕获两处 test-only 类型问题（对象字面量把 `changeType` 宽化成 `string`、
  helper 形参用了 `Record<string, unknown>` 而非 `JsonObject`）。vitest 不做类型检查，
  只跑测试不会发现 —— 记录在此说明**两道关卡都必须跑**。

## 真机验证 ✅ 已通过（2026-08-13 20:05–20:11）

账号 `85068938` / 银际酒店(包头市青山王府井文化路店)，rms-server 本地 `localhost:8080`。

| 时刻 | 操作 | endpointId | changeType | roomStatus | rmsChangeId | rmsStatus |
|---|---|---|---|---|---|---|
| 20:08:26 | 关房（多门店） | `setbatchroombookablestatus` | `roomStatus` | — | 17 | DISPATCHED |
| 20:08:36 | 关房（多门店） | 同上 | `roomStatus` | — | 18 | DISPATCHED |
| 20:10:12 | **关房** | 同上 | `roomStatus` | **`"N"`** | 19 | DISPATCHED |
| 20:10:42 | **开房** | 同上 | `roomStatus` | **`"G"`** | 20 | DISPATCHED |

### 逐条兑现的设计决策

- **开/关房同一个 `endpointId`**（决策 4）—— 19 与 20 的 `endpointId` 完全相同，
  只有 `changeRaw.roomStatus` 是 `N` / `G`。RMS 据此区分方向。
- **`holidyInfo` 确被剔除**（决策 5）—— 实际上报的
  `dateItemInfoDtoList: [{"startDate":"2026-08-19","endDate":"2026-08-19"}]`，
  节假日字典不在其中，其余字段（`weekDayIndex`/`pageType`/`processType`/
  `originalRoomProductIds`）原样保留。
- **`isSuccessful` 按端点分支生效**（决策 6）—— 四次全部判定成功并上报。若仍走改价
  老模块那条查 `roomPriceSetResults` 的路径，`data: null` 会让每次都判失败、零上报。
- **多门店分支真实触发**（风险表最后一行）—— 前两次日志出现
  `Ctrip room status: one save spans multiple hotels { hotelIds: ['115348672','115355969'] }`，
  `otaHotelId` 取第一家，完整清单在 `changeRaw` 里。⚠️ **这不是假想场景，RMS 必须遍历
  `changeRaw.hotelRoomInfoDtoList[].hotelID`**。
- **`changeType` 全链路打通** —— `rmsStatus: DISPATCHED` 说明 rms-server 收下了带新字段的
  报文，未因未知字段拒绝。

`rmsItems` 分别为 8 / 8 / 1 / 1，与操作涉及的房型数一致（RMS 侧自行展开）。

## 未完成

| 任务 | 内容 | 阻塞原因 |
|---|---|---|
| 8.4 | 抓一次**被携程拒绝**的房态响应样本 | 需构造失败场景（如改已售罄日期），本次未遇到 |
| 9.1 | 把 spec delta 合并进 `openspec/specs/` | 等美团关房也真机验完，两份 delta 一并合并 |
