# 验证证据

日志来源：`~/Library/Logs/Electron/staff/main.log`（dev 环境），2026-08-21 真机联调。
RMS 为本地 `localhost:8080`。

## 结论

**四个端点真机全部拦到并成功上报。** 携程三个菜单的价量态操作现已全覆盖。

发现一个**服务端**缺陷（按比例调价解析失败），desktop 侧无需改动，详见 §待服务端处理。

## 端点覆盖矩阵

| 端点 | 菜单 | 本次改动 | 真机 | 证据 |
|---|---|---|---|---|
| `batchsetroomprice` | 日历·改价 | 无（既有） | ✅ | 20:14:38 |
| `setbatchroombookablestatus` | 日历·房态 | 无（既有） | ✅ | 20:16:11 / 20:16:16 |
| `setUniformRCRoomPrice` | 房价维护·统一加减价 | **A 新增** | ✅ | 5 次，见下 |
| `batchUpdateRoomStatusAndQuantity` | 房态房量 | **C 新增** | ✅ | 3 次，见下 |
| `setRCRoomPrice` | 房价维护·逐项设价 | 无（既有） | ⚠️ **未覆盖** | 本轮未操作该入口 |

## A 块：统一加减价（`setUniformRCRoomPrice`）

改动前该入口**一次都拦不到**（端点常量缺失）。改动后 5 次操作全部拦到：

```
19:59:30  costPrice  multiply  1.001   → PARSE_FAILED   ← 服务端问题，见下
20:01:31  salePrice  multiply  1.001   → PARSE_FAILED   ← 同上
20:09:27  salePrice  subtract  1       → SKIPPED
20:22:55  salePrice  subtract  1       → SKIPPED
20:40:56  salePrice  add       ?       → SKIPPED
```

三个 `adjustmentPrice*` 字段按预期透传进 `changeRaw`（20:09:27 样本）：

```json
"adjustmentPriceType": "salePrice",
"adjustmentPriceOperationsType": "subtract",
"adjustmentPriceValue": 1
```

`otaHotelId` 请求体内为空串，经既有的携程预付/现付归一逻辑补为 `masterHotelId: 122244992`
（`Ctrip hotel id replaced with masterHotelId`），与设计一致。

## C 块：房态房量菜单（`batchUpdateRoomStatusAndQuantity`）

改动前该页面**不在 `WATCH_PATHS` 内，整个 tab 的监听会被 detach**。改动后：

```
19:40:46  roomStatus: 1  开房   → HOTEL_UNRESOLVED（当时门店尚未绑妥）
19:47:18  roomStatus: 2  关房   → SKIPPED
19:47:28  roomStatus: 1  开房   → SKIPPED
```

✅ **`roomStatus` 的 `1` 开 / `2` 关两个方向都真机验证过**，数字码原样透传未被归一化
（未出现日历菜单那套 `"G"`/`"N"`），与 design D4 / spec 的「不归一化」约定一致。

✅ `otaHotelId` 请求体内无门店 ID，同样由 masterHotelId 兜底为 `122244992`；
日志按设计记的是 `info` 而非 `warn`：

```
Ctrip room status/quantity: no hotelID in body, RMS will resolve by room product
```

## 三个 rmsStatus 的含义（均为正常终态）

按 spec「上报是单向通知」，下游终态不触发 desktop 重试或告警：

| 状态 | 含义 | 是否异常 |
|---|---|---|
| `SKIPPED` | 服务端收下但未处理（房型未开通跟价等） | 否 |
| `HOTEL_UNRESOLVED` | 门店反查未命中 | 否（当时绑定未就绪） |
| `DISPATCHED` | 已派发处理 | 否 |
| `PARSE_FAILED` | **解析失败** | ⚠️ 见下 |

## 按比例调价解析失败 —— ✅ 服务端已修复

**现象**：`adjustmentPriceOperationsType` 为 `multiply` 时，服务端两次都返回 `PARSE_FAILED`；
`subtract` / `add` 三次均正常。

```
multiply  → PARSE_FAILED  ×2   （19:59:30 costPrice / 20:01:31 salePrice）
subtract  → SKIPPED       ×2   （20:09:27 / 20:22:55）
add       → SKIPPED       ×1   （20:40:56）
```

**定性**：desktop 侧无问题 —— 报文完整、字段齐全、`isSuccessful` 判定正确、上报成功
（HTTP 200）。是服务端未实现按比例调价（`multiply`）的解析分支。

⚠️ 注意 `multiply` 时 `adjustmentPriceValue` 是**倍率**（如 `1.001`）而非绝对金额，
与 `add`/`subtract` 的量纲不同 —— 服务端补解析时不能套用同一套换算。

**影响**：用户用「按比例」方式调价时，RMS 收得到但解析不了，等同于跟价失效。

**处置**：✅ 服务端已修复（2026-08-21 经用户确认）。上述记录保留备查 —— 量纲差异
（`multiply` 是倍率、`add`/`subtract` 是绝对金额）是后续维护该解析分支时的必要背景。

## 未完成项

| 项 | 状态 |
|---|---|
| `setRCRoomPrice`（逐项设价）真机 | ⚠️ 本轮未操作该入口。属既有端点、本次未改动其解析路径，风险低 |
| B 块（联动房型）真机 | **不再要求**（2026-08-21 用户确认）。本轮样本 `relationRoomProducts` 均为空数组未触发；判定依据为单测覆盖，见下 |
| 房量字段 | 本次不采集，按 design D9 透传不解析 |

**B 块的证据来源是单测而非真机**，如实记录如下：
- 正向：只有 `relationRoomProducts` 时不被丢弃（修复前会误丢）
- 反向：`excludedRelationRoomProductIds` 中的房型不被当作定位依据
- 有效性：移除修复代码后正向用例确实变红，恢复后变绿

该缺陷只影响「改价被误判丢弃」的边界情况，不影响本次已真机验证的正常路径。

## 自动化测试

ctrip 相关 62 个测试全绿（本次新增 21 个），`tsc` 与 `eslint` 零错误。
B 块测试做过反向验证：移除修复后「只有联动房型时不被丢弃」确实变红。

`apps/desktop/tests/unit/main/` 全量为 `1 failed | 662 passed`，另 10 个文件收集失败 ——
经 stash 基线对比确认**与本次改动无关**（Electron 环境既有问题，基线同样如此）。
