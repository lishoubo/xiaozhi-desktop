# 携程价量态上报 —— 服务端对接说明

> 对应 desktop 提交 `c84ba33`（change `extend-ctrip-price-status-coverage`）。
> 字段级规格的事实来源是 desktop 侧的三份 payload 模块，本文是给服务端的摘要与工作清单。

## 一句话

**新增一个 `endpointId` 的解析分支：`batchUpdateRoomStatusAndQuantity`。** 其余全部零改动。

## 本次 desktop 改了什么，服务端要不要跟

| 块 | 内容 | `endpointId` | 服务端 |
|---|---|---|---|
| A | 房价维护菜单·统一加减价 | `setUniformRCRoomPrice` | ✅ **零改动** |
| B | 改价联动房型漏收（既有缺陷修复） | 不涉及 | ✅ **零改动** |
| C | 房态房量菜单 | `batchUpdateRoomStatusAndQuantity` | ⚠️ **需新增解析分支** |

**A 为什么零改动**：请求体与 `setRCRoomPrice` 同构，只多三个 `adjustmentPrice*` 字段
（加减方向与幅度）。现有解析逻辑直接能跑，新字段靠透传自动进 `changeRaw`。

> ⚠️ **2026-08-21 联调发现一个已有缺陷需要修**（与本次 desktop 改动无关，但同一批上线要用到）：
> `adjustmentPriceOperationsType` 为 `"multiply"` 时服务端返回 `PARSE_FAILED`，
> `"add"` / `"subtract"` 正常。详见下方 §按比例调价。

**B 为什么零改动**：只影响 desktop 侧「这是不是一次真实改价」的丢弃判定。`changeRaw`
一直是全量透传，联动房型本来就在里面 —— 修的是「改价被整个丢弃」，不是「字段没传」。

## 契约没有变化

`OtaAmountChangeReport` 一个字段都没动，`changeType` 也没扩枚举：

```
operationId / loginUserId / loginUserName / source
endpointUrl / endpointId / changeType / otaHotelId / changeRaw
```

变的只是 `changeRaw` 多了一种形状 —— 它的结构本来就由 `source` + `endpointId` 共同决定。

## 携程当前的五个端点全景

```
日历菜单        /ebkovsroom/inventory/calendar
  ├── 改价 batchsetroomprice                    changeType: price
  └── 房态 setbatchroombookablestatus           changeType: roomStatus   "G"/"N" 字符串
房价维护菜单    /rateplan/batchPriceSetting
  ├── 改价 setRCRoomPrice                       changeType: price
  └── 改价 setUniformRCRoomPrice        【A】   changeType: price
房态房量菜单    /rateplan/batchSetRoomStatusAndQuantity
  └── 房态房量 batchUpdateRoomStatusAndQuantity 【C】changeType: roomStatus   1/2 数字
```

## ⚠️ 按比例调价（`multiply`）解析失败 —— 需修复

2026-08-21 真机联调实测：

```
adjustmentPriceOperationsType  结果
  multiply                     PARSE_FAILED  ×2
  subtract                     SKIPPED       ×2   （正常终态）
  add                          SKIPPED       ×1   （正常终态）
```

desktop 侧报文完整、上报成功（HTTP 200），是服务端未实现 `multiply` 分支。

⚠️ **量纲不同，不能套用同一套换算**：

| `adjustmentPriceOperationsType` | `adjustmentPriceValue` 含义 | 示例 |
|---|---|---|
| `add` / `subtract` | **绝对金额**（元） | `1` = 加/减 1 元 |
| `multiply` | **倍率** | `1.001` = 乘以 1.001 |

`adjustmentPriceType` 指出调的是哪个价：`salePrice`（卖价）或 `costPrice`（底价）。

**影响**：用户用「按比例」方式调价时，RMS 收得到但解析不了，等同于跟价失效。

---

# C 块：服务端工作清单

## 1. ⚠️ 两个房态端点零字段同名，不能套用现有路径

`changeType` 同为 `roomStatus`，但请求体**没有一个字段是同名的**：

| 维度 | 老 `setbatchroombookablestatus` | 新 `batchUpdateRoomStatusAndQuantity` |
|---|---|---|
| 房型 | `hotelRoomInfoDtoList[].roomTypeID` 数字 | `roomProductIds[]` 顶层**字符串**数组 |
| 门店 | ✅ `hotelRoomInfoDtoList[].hotelID` | ❌ **请求体里没有** |
| 日期 | `dateItemInfoDtoList[]` | `dates.dateRanges[]` |
| 周次 | `weekDayIndex: "1111111"` 位串 | `dates.weekDays[]` 英文枚举 |
| 全选 | 无 | `dates.applyAllDates` 布尔 |
| 开关房 | `roomStatus: "G"` / `"N"` **字符串** | `roomStatus: 1` / `2` **数字** |
| 房量 | 无 | 三个字段（**本次不解析**） |

⚠️ 套错路径的失效方式是**静默丢弃**：每条都取不到房型，日志上与「用户没操作」一样。
**必须先按 `endpointId` 分辨，再决定读哪套字段。**

## 2. ⚠️ 开关房判据按 `endpointId` 分，desktop 不归一化

```
setbatchroombookablestatus        →  "G" 开房 / "N" 关房
batchUpdateRoomStatusAndQuantity  →   1  开房 /  2  关房
```

desktop **原样透传两套、不归一化** —— 归一化属于语义转换，违背「只当探针、不解读渠道语义」
的定位。所以这个分辨**必须服务端做**。

⚠️ **判反了会造成超售。** 只看 `changeType: roomStatus` 分不出方向。

取值来源：2026-08-21 踩点，开房与关房两份请求体逐字段 diff **只差 `roomStatus` 一处**
（`roomProductIds`、`dates`、`cipher` 完全一致）。**只有 `1` 和 `2` 是已证实的**，出现第三种
取值不要猜。

## 3. `otaHotelId` 恒为空串，按 `roomProductIds[]` 反查

该端点请求体里**没有任何门店标识**。空串是**正常情况不是错误** —— desktop 只当探针，不查
本地绑定、不操作页面去凑这个值。

⚠️ **一次操作可能跨多家门店**（踩点样本里 `1602330530` 与 `1569052068` 就分属两家），
**必须遍历 `roomProductIds[]` 全量反查**，不能只认第一个。

这一条现有 spec「门店定位是尽力而为」已有约定，不算新要求。

## 4. ⛔ 房量三字段：收下但本次不解析

```json
"roomQuantityLimitType": -100,
"remainRoomQuantityType": -100,
"syncRoomQuantityWithSharedInventory": true
```

本次**不踩点**房量。desktop 照常全量透传（透传是既定语义），**服务端不解析、不消费**。

⚠️⚠️ **不要把 `-100` 当成房量值写进业务台账。** 开房与关房两份样本改的都是**房态**，这三个
字段纹丝不动 —— 据此**推测** `-100` 是「本次不改房量」的哨兵值，但**未经专门验证**。

要消费房量数据，须先补做「只改房量」与「房态房量同改」两份踩点。

## 5. 日期展开方式与老端点不同

`dates.dateRanges[]`（区间，闭区间）与 `dates.weekDays[]`（英文全大写枚举）是**交集**关系：
区间内、且星期几命中的那些天才生效。desktop 不展开，展开由服务端做。

⚠️ 周次表达是英文枚举，**不是**老端点的 `"1111111"` 位串，不能复用同一套解析。

⚠️ `dates.applyAllDates` **语义未证实**（两份样本都是 `false`）。为 `true` 时是否意味着忽略
前两项而应用到全部日期，没有样本 —— 遇到 `true` 不要臆断，应补踩点确认。

## 6. 成功判定与时效

desktop 侧已按渠道响应判过成败，**判失败的根本不会上报**，服务端收到即代表携程确认成功。

⚠️ 但该端点是**异步任务**（响应带 `taskId`）：`rcode: 200` 只代表携程**受理成功**，
不代表房态已生效。若对时效敏感需考虑这层延迟。（与改价新模块同一处境；老房态端点没有
`taskId`，应该是同步生效。）

---

# `changeRaw` 完整样本（真实报文）

开房（`roomStatus: 1`）。关房样本与此**逐字节相同，只有 `roomStatus` 变成 `2`**：

```json
{
  "roomProductIds": ["1602330530", "1569052068"],
  "dates": {
    "dateRanges": [{ "startDate": "2026-08-27", "endDate": "2026-08-28" }],
    "weekDays": ["SUNDAY","MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY"],
    "applyAllDates": false
  },
  "roomStatus": 1,
  "roomQuantityLimitType": -100,
  "remainRoomQuantityType": -100,
  "syncRoomQuantityWithSharedInventory": true
}
```

`reqHead` / `cipher` / `head` 三个 SOA 框架字段已由 desktop 剔除（分别含设备指纹、
`tripsign` 签名串、`auth` 鉴权字段），不会出现在 `changeRaw` 里。

## 逐字段含义

| 字段 | 类型 | 示例 | 含义 | 怎么用 |
|---|---|---|---|---|
| `roomProductIds` | string[] | `["1602330530","1569052068"]` | 本次操作的销售房型 ID | ⭐ 必读。定位房型 + **反查门店** |
| `dates.dateRanges` | `{startDate,endDate}[]` | `[{2026-08-27, 2026-08-28}]` | 生效日期区间，闭区间 | ⭐ 必读，与 `weekDays` 取交集 |
| `dates.weekDays` | string[] | `["SUNDAY","MONDAY",…]` | 区间内哪几个星期几生效 | ⭐ 必读，与 `dateRanges` 取交集 |
| `dates.applyAllDates` | boolean | `false` | 是否勾了「应用到所有日期」 | ⚠️ 语义未证实，遇 `true` 勿臆断 |
| `roomStatus` | number | `1` / `2` | **`1` 开房，`2` 关房** | ⭐ 必读。⚠️ 与老端点 `"G"/"N"` 不同 |
| `roomQuantityLimitType` | number | `-100` | 房量限制类型 | ⛔ 本次不解析 |
| `remainRoomQuantityType` | number | `-100` | 剩余房量类型 | ⛔ 本次不解析 |
| `syncRoomQuantityWithSharedInventory` | boolean | `true` | 是否与共享库存同步房量 | ⛔ 本次不解析 |

---

# 上线时序

```
A、B 两块  desktop 上线后服务端无需任何动作
C 块       服务端解析分支就绪  →  desktop 的 C 块才可上线
```

C 块上线前需与服务端确认两件事（对应 `tasks.md` 6.1 / 6.2）：

1. 已能处理 `batchUpdateRoomStatusAndQuantity` 的 `changeRaw` 形状及空 `otaHotelId`
2. 已对齐 `roomStatus` 的 `1` 开 / `2` 关，且明确房量三字段不解析、`-100` 不当房量值

# 相关文件

| 用途 | 路径 |
|---|---|
| 本端点字段级规格（**事实来源**） | `apps/desktop/src/main/channels/ctrip/room-status-quantity-payload.ts` |
| 改价三端点规格 | `apps/desktop/src/main/channels/ctrip/amount-change-payload.ts` |
| 日历菜单房态端点规格 | `apps/desktop/src/main/channels/ctrip/room-status-payload.ts` |
| 拦截/判定/定位逻辑 | `apps/desktop/src/main/channels/ctrip/amount-change-adapter.ts` |
| 上报行为契约 | `openspec/specs/ota-amount-change-report/spec.md` |
| 踩点原始报文 | `docs/踩点/携程/房态房量菜单.md`、`房价维护菜单踩点.md`、`日历菜单-价量态修改踩点.md` |
