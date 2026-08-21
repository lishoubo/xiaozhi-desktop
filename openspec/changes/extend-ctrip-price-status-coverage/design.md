# 携程价量态监听覆盖补齐 —— 技术方案

## Context

动机见 `proposal.md`。这里只放实现所需的现状事实。

### 携程三个菜单 → 页面 → 端点的全景

```
携程 ebooking 后台
│
├── 日历菜单
│   └── /ebkovsroom/inventory/calendar
│       ├── /ebkovsroom/api/inventory/batchsetroomprice          改价·老模块   ✅ 已覆盖
│       └── /ebkovsroom/api/inventory/setbatchroombookablestatus 房态·老模块   ✅ 已覆盖
│
├── 房价维护菜单
│   └── /rateplan/batchPriceSetting                              ✅ 页面已在 WATCH_PATHS
│       ├── /restapi/soa2/23783/setRCRoomPrice                   改价·逐项     ✅ 已覆盖
│       └── /restapi/soa2/23783/setUniformRCRoomPrice            改价·统一加减 ❌ 缺端点常量
│
└── 房态房量菜单
    └── /rateplan/batchSetRoomStatusAndQuantity                  ❌ 页面未声明 → 整个 tab detach
        └── /restapi/soa2/23783/batchUpdateRoomStatusAndQuantity 房态房量·新   ❌ 端点+规格全缺
```

踩点来源：`docs/踩点/携程/日历菜单-价量态修改踩点.md`、`房价维护菜单踩点.md`、`房态房量菜单.md`。

### 现有代码的三个约束点

| 位置 | 当前值 | 机制 |
|---|---|---|
| `WATCH_PATHS` | `['/ebkovsroom/inventory', '/rateplan/batchPriceSetting']` | `pathname.startsWith`；不匹配 → `stopWatching()` → `detach()` |
| `WATCHED_ENDPOINTS` | 3 条 | `url.includes(fragment)`，**首个命中即返回** |
| `isSuccessful(body, endpointId)` | 房态按 `endpointId` 分支，改价新老靠形状自辨 | 见 `amount-change-adapter.ts` 文件头 |

## Goals / Non-Goals

**Goals**
- 携程三个菜单的价量态操作全部可观测，无静默漏报。
- 新端点的 `changeRaw` 规格对 RMS 可读，形状差异有明确文档。
- 第 1、2 块不被第 3 块的踩点空白阻塞。

**Non-Goals**
- 不归一化两个房态端点的取值表达（`"G"/"N"` vs 数字）—— 归一化是语义转换，违背透传定位。
- 不为新端点补门店 ID。请求体里没有就是没有，`otaHotelId` 留空串，RMS 按 `roomProductId` 反查。
- 不动抖音、美团适配器。
- 不改 `OtaAmountChangeReport` 契约，不加 `changeType` 取值。

## Decisions

### D1：三块按风险切开，独立可交付

| 块 | 内容 | 风险 | 阻塞 |
|---|---|---|---|
| A | 补 `setUniformRCRoomPrice` 端点常量 | 极低 | 无 |
| B | 修联动房型 `relationRoomProducts` 漏收 | 低 | 无 |
| C | 接 `batchUpdateRoomStatusAndQuantity` | 中 | ~~踩点样本~~ ✅ 已解锁 |

A、B 零风险可先落地。C 原本阻塞于三个未知量，2026-08-21 踩点后已全部解除（见 §踩点确认结果），三块均可开工。

### D2：`setUniformRCRoomPrice` 复用改价新模块的全部逻辑

请求体与 `setRCRoomPrice` 同构，只多三个加减价字段：

```
roomPriceInfos[] / dateRanges[] / weekDays        ← 与 setRCRoomPrice 完全一致
adjustmentPriceType            "salePrice"        ← 新增
adjustmentPriceOperationsType  "subtract"         ← 新增，加减方向
adjustmentPriceValue           1                  ← 新增，幅度
```

响应完全一致（`taskId` + `resStatus.rcode` + `ResponseStatus.Ack`）。

| 复用点 | 结论 |
|---|---|
| `isSuccessful` | 形状自辨已命中 `resStatus` 分支，**零改动** |
| `toCtripAmountChangeRaw` | 噪音字段同为 `reqHead`/`cipher`/`head`，**零改动** |
| `roomProductIdsOf` | 读 `roomPriceInfos[].roomProductId`，**零改动**（但见 D3） |
| `WATCH_PATHS` | 同页面，**零改动** |
| `WATCHED_ENDPOINTS` | **加一行** |

三个加减价字段无需建模 —— 透传原则下它们自动进 `changeRaw`。

**端点片段取 `setUniformRCRoomPrice`，不含 `soa2/23783`** —— 与既有 `setRCRoomPrice` 同一理由（服务编号是部署产物）。

⚠️ **子串检查**：`matchEndpoint` 首个命中即返回，`setRCRoomPrice` 与 `setUniformRCRoomPrice` **互不为子串**（`Uniform` 插在中间，前者不是后者的子串），顺序无关。需单测钉住。

### D3：联动房型两个字段方向相反，只收「一并改」那个

```
refRoomIDs                        老模块  一并改了这些   ✅ 已收
relationRoomProducts[]            新模块  一并改了这些   ❌ 漏收 ← 本次修
excludedRelationRoomProductIds    新模块  排除这些       ⛔ 绝不能收
```

`relationRoomProducts` 是对象数组 `[{roomProductId, mealNum}]`，不是 ID 数组，取值路径与 `excludedRelationRoomProductIds`（裸 ID 数组）不同。

**影响面**：`roomProductIdsOf` 只用于「这是不是一次真实改价」的判定，不进 `changeRaw`（`changeRaw` 本来就全量透传）。所以修复只影响**丢弃判定**：极端情况下用户只改联动房型时当前会被误丢。属既有缺陷，顺带修。

| 方案 | 结论 |
|---|---|
| 只收 `roomProductId` | ❌ 现状，漏联动 |
| 收 `roomProductId` + `relationRoomProducts[].roomProductId` | ✅ 采纳 |
| 顺带收 `excludedRelationRoomProductIds` | ⛔ 语义相反 |

### D4：新房态房量端点单独建一份 payload 模块

与老房态端点零字段同名：

| 维度 | `setbatchroombookablestatus`（老） | `batchUpdateRoomStatusAndQuantity`（新） |
|---|---|---|
| 房型 | `hotelRoomInfoDtoList[].roomTypeID` | `roomProductIds[]` 顶层字符串数组 |
| 门店 | ✅ `hotelRoomInfoDtoList[].hotelID` | ❌ **无** |
| 日期 | `dateItemInfoDtoList[]` | `dates.dateRanges[]` |
| 周次 | `weekDayIndex: "1111111"` 位串 | `dates.weekDays: ["SUNDAY",…]` 枚举 |
| 全选 | 无 | `dates.applyAllDates` |
| 房态 | `roomStatus: "G"/"N"` 字符串（G 开 / N 关） | `roomStatus: 1｜2` **数字**（**1 开 / 2 关**） |
| 房量 | 无 | `roomQuantityLimitType` / `remainRoomQuantityType` / `syncRoomQuantityWithSharedInventory` |
| 噪音 | `dateItemInfoDtoList[].holidyInfo` | `reqHead` / `cipher` / `head` |
| 响应 | `{code:200, returnCode:"200", data:null}` | `{taskId, resStatus:{rcode}, ResponseStatus:{Ack}}` |

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 塞进 `room-status-payload.ts` | 文件少 | 一份文件讲两种零重叠形状，与改价那份「两套模块」的教训同型且更糟 | ❌ |
| 新建 `room-status-quantity-payload.ts` | 每份文件一种形状；RMS 按 `endpointId` 找文件 | 多一个文件 | ✅ 采纳 |

裁剪口径与改价新模块一致（同为 SOA 框架，噪音字段相同）：

```ts
export type CtripRoomStatusQuantityRaw = JsonObject & Readonly<{
  roomProductIds?: readonly unknown[];
  dates?: JsonObject;              // { dateRanges[], weekDays[], applyAllDates }
  roomStatus?: number;             // 1 = 开房, 2 = 关房（2026-08-21 踩点确认）
  // 房量三字段：透传但本次不解析，RMS 不消费（D9）。⚠️ `-100` 疑为哨兵，非房量值
  roomQuantityLimitType?: number;
  remainRoomQuantityType?: number;
  syncRoomQuantityWithSharedInventory?: boolean;
}>;

export function toCtripRoomStatusQuantityRaw(requestBody: JsonObject): CtripRoomStatusQuantityRaw;
```

### D5：成功判定按 `endpointId` 分派，新端点复用新模块判据

新端点响应是标准 SOA 信封，与 `setRCRoomPrice` 同构 → 直接复用 `isNewModuleSuccessful`。

```
isCtripSaveSuccessful(body, endpointId)
├── endpointId === 'setbatchroombookablestatus'          → isRoomStatusSuccessful
├── endpointId === 'batchUpdateRoomStatusAndQuantity'    → isNewModuleSuccessful   ← 新增分支
└── 其余（改价三端点）                                     → 形状自辨（resStatus 在不在）
```

⚠️ **必须显式加分支，不能靠形状自辨兜住**。虽然新端点确实有 `resStatus`、落到自辨分支也能判对，但那是**巧合而非契约**：一旦携程给这个端点换个信封，失效方式是静默漏报。文件头已就此警告过一次（房态老端点与改价老模块形状撞车），同一个坑不踩第二次。

### D6：`WATCH_PATHS` 加页面前缀，注意 `startsWith` 的前缀关系

```
现有  /rateplan/batchPriceSetting
新增  /rateplan/batchSetRoomStatusAndQuantity
```

两者**互不为前缀**（`batchPriceSetting` vs `batchSetRoomStatus…`，第二段就分叉），`some(startsWith)` 无歧义。

⚠️ 不能图省事写 `/rateplan` —— 那会把房价维护、房态房量之外的所有 rateplan 子页面都纳入监听，扩大 CDP attach 面。按页面精确声明。

### D7：新端点的 `changeType` 取 `roomStatus`

同一请求携带房态与房量 → 按现有 spec「一次请求里的多项改动合并为一条上报」，`changeType: 'roomStatus'`，实际内容由 RMS 从 `changeRaw` 读。无需扩充枚举。

### D8：定位校验只认 `roomProductIds`

新端点没有门店 ID，房型标识只有顶层 `roomProductIds` 一处。

```ts
// 硬错误：一个房型都取不到 → 丢弃（与其余分支同口径）
if (roomProductIds.length === 0) { logger.warn(...); return null; }
// otaHotelId 恒为空串 —— 正常情况，不记 warn，记一条 info 备查
```

⚠️ 与老房态分支的 `roomStatusRoomIdsOf`（收两处）不同，这里只有一处。**不要复用那个函数**。

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| ~~`roomStatus` 数字码方向猜错 → 超售~~ | ✅ 已消除：踩点确认 `1` 开 / `2` 关（见下方确认结果）。仍原样透传，不在 desktop 侧解读 |
| 房量三字段哨兵值 `-100` 含义未证实 | 本次不消费房量：desktop 透传、RMS 不解析（D9）。⚠️ RMS 不得把 `-100` 当房量值 |
| ~~该菜单可能还有非批量单点入口~~ | ✅ 已排除：踩点确认该页面只有批量入口 |
| 新端点是**异步任务**（响应带 `taskId`）→ 成功只代表受理 | 与改价新模块同一处境，已在既有文档记录；RMS 对时效敏感时需考虑延迟 |
| **只有成功样本，无失败样本** → `isSuccessful` 可能过松 | 与老房态端点同一状态；真机若能构造失败应抓样本回填并收紧 |
| 端点片段不含服务编号 → 理论上可能误匹配 | `isWatchableUrl` 兜底：只有停在这两个页面时才 attach |

## Migration Plan

无数据迁移、无部署变更。纯 desktop 端观测面扩大。

- **上线顺序**：A + B 一起提交（零风险）；C 待踩点补齐后单独提交。
- **回滚**：删掉新增的端点常量与页面前缀即可回到当前行为，无残留状态。
- **RMS 协同**：C 块上线**前**需与 RMS 确认已能处理 `batchUpdateRoomStatusAndQuantity` 的 `changeRaw` 形状及空 `otaHotelId`。A、B 不需要 —— A 的形状 RMS 已能处理，B 不改 `changeRaw`。

## 踩点确认结果（2026-08-21，C 块已解锁）

| # | 事项 | 结论 |
|---|---|---|
| 1 | `roomStatus` 数字码语义 | ✅ **`1` 开房 / `2` 关房**。开关两份 curl 逐字段 diff，**整个请求体只差这一个字段**（`roomProductIds`/`dates`/`cipher` 完全一致），开关同端点同形状 |
| 2 | 房量三字段取值 | ⏸️ **本次不踩点**。字段照常透传，**服务端不解析** —— 见 D9 |
| 3 | 是否有非批量单点入口 | ✅ **没有**，该页面只有批量入口。端点全景图无需扩充 |

开关房**不拆两个 `endpointId`** —— 同端点、同形状、只差一个字段的取值，与日历菜单老房态端点同一处置；与美团相反（美团开关房是两个独立端点）。

响应两份一致，均为标准 SOA 信封（`taskId` + `resStatus.rcode:200` + `ResponseStatus.Ack:"Success"`），D5 复用 `isNewModuleSuccessful` 的判断成立。

### D9：房量字段透传但不解析

`roomQuantityLimitType` / `remainRoomQuantityType` / `syncRoomQuantityWithSharedInventory` 三个字段本次**不踩点**。

已知信息（来自开关房两份样本的旁证，非专门踩点）：

```
roomQuantityLimitType:               -100    开房关房两份都是这个值
remainRoomQuantityType:              -100    同上
syncRoomQuantityWithSharedInventory: true    同上
```

⚠️ 两份样本改的是**房态**，房量三字段纹丝不动 —— 这**旁证**了 `-100` 大概是「本次不改房量」的哨兵值，但**未经专门验证**。真正改房量时填什么，未知。

| 层 | 处置 |
|---|---|
| desktop | **照常全量透传**。本来就是透传语义，无需为此写任何代码 —— 不解析、不校验、不裁剪 |
| RMS | **不解析这三个字段**。本次不消费房量数据 |

⚠️ **RMS 侧务必不要把 `-100` 当成房量值写进台账** —— 该值极可能是哨兵而非真实房量。要消费房量时须先补做房量踩点。

`changeType` 仍为 `roomStatus`（现有 spec 已定义其涵盖房态与房量，无需改动）。

## Open Questions

**房量字段的真实取值语义**（`-100` 是否确为「不改」哨兵、真正改房量时填什么）。

可安全延后：本次 desktop 全量透传、RMS 不解析，该未知量不改变本 change 的 specs、实现方式与任务拆分。要消费房量数据时须先补踩点。
