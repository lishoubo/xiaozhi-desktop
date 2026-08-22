## Context

见 `proposal.md` §Why。本节只列决定方案形状的既有约束。

**现状**：`meituan/amount-change-adapter.ts` 的 `parse` 对 `calcPriceV2` 返回
`{ kind: 'context' }`，机制层（`amount-save-capture.ts`）**整条替换**上一份 context；
`updatePriceV2` 且 `createFlag: true` 时取出该 context 作为 `changeRaw` 上报。

**三层数据，只有两层出得去** —— 后面的决策反复提到这三者，先厘清边界：

```
用户在美团页面操作
      │
      ├─ calc 请求 ×N ──► ┌──────────────┐
      │                   │ CalcContext  │  ① 进程内暂存，**永不外发**
      │                   │  (内存)      │     页面 detach 即销毁
      └─ update 提交 ────► └──────┬───────┘
                                  │ 提交时倒出来，重建成上报形状
                                  ▼
                          ┌────────────────────────┐
                          │ MeituanAmountChangeRaw │  ② 上报体，**发给 RMS**
                          │  ├ goodsDetails[]      │
                          │  └ calcUpdateCheck     │  ③ 新模型，长在②里面
                          └───────────┬────────────┘
                                      ▼  POST /api/v1/app/ota-changes
                                     RMS
```

① 换结构对 RMS **完全无感**（它看不到）；②③ 才是契约面。

**踩点实测**（`docs/踩点/美团/批量改房价-基础改价.md`，一次操作的完整序列）：

```
req0  calc    goods=[787306, 800654, 818026]   全周档  ← 初次勾选 3 个房型
req1  calc    goods=[787306]                   [5,6]   ← 开周末差异定价
req2  calc    goods=[787306]                   [5,6]   ← 改数值
req3  calc    goods=[818026]                   [1,2,3,4,7]
req4  update  goods=[3 个都在] createFlag=false          ← 预检
req5  update  goods=[3 个都在] createFlag=true           ← 提交，6 个价格档
```

当前实现上报 req3 —— **3 个房型只覆盖 1 个**。

**约束**：

| 约束 | 来源 | 影响 |
|---|---|---|
| `parse(observed, context)` 的 context 内容语义**完全归适配器** | `channels/types.ts` | 累积逻辑无需改机制层 |
| context 生命周期 = 页面会话（`detach()` 即销毁） | `amount-save-capture.ts` 文件头 | 天然隔离不同 tab／门店 |
| 适配器**无状态**，三渠道共用一份实例 | `registry.ts` 建一次 | 累积结果必须存 context，不能存适配器字段 |
| `changeRaw` 之外的上报字段**渠道无关** | `shared/types/amount-change.ts` | 对账结果只能放 `changeRaw` 内 |
| desktop 只当探针，不解读语义 | `openspec/specs/ota-amount-change-report` | 对账只做「值等不等」，不判断谁对 |

## Goals / Non-Goals

**Goals:**
- 累积覆盖用户实际触碰过的全部 (房型 × 日期区间 × 周次档)
- 提交时对账，把「素材是否可信」这个判断**交给 RMS**，desktop 不替它决定
- 上报后清空，不跨改动泄漏

**Non-Goals:**
- **不改关房链路**。`deductRoomCount` 仍不拦 —— 已确认日历页关房同样先发 `submitaudit`
  （2026-08-14 真机验证：关房只产生一条上报）。本次零改动。
- **机制层只动「上报即清空 context」一处**（实现时修正，原计划零改动）。理由见决策 7：
  适配器无状态、交出 report 后没有再碰状态的机会，而「一次上报消费掉一份上下文」是渠道
  无关的规则。除此之外 `amount-save-capture.ts` 不动。
- **不做语义换算**。对账只比字面值，不把 `operateType: 1`（加价）换算成绝对值去比。
- **不改是否上报的判定**。对账结果不构成准入门槛，见 spec。

## Decisions

### 决策 1：累积键取 `(goodsId, startDate, endDate, inWeek)`

踩点里同一 goodsId 的两个日期段被分别调整（`批量改房价-高级改价.md` 的 calc0 与 calc2），
同一 goodsId 同一日期段的两个周次档也被分别调整（`基础改价` 的 req1 与 req3）。键少一
个维度就会误覆盖。

`inWeek` 是数组，序列化为**升序 join** 后入键 —— 美团给的顺序实测稳定，但不依赖它。

| 候选键 | 问题 | 结论 |
|---|---|---|
| `goodsId` | 同房型多日期段互相覆盖 | ❌ |
| `goodsId + 日期段` | 同日期段的周末档与工作日档互相覆盖 | ❌ |
| `goodsId + 日期段 + 周次档` | 实测无冲突 | ✅ |

### 决策 2：改前价保留首次，改后价取最新

req1（65159 → 65100）后 req2 又改同一档，此时 req2 的 `originalPriceInfo` 已是 65100
（前一次的结果）。直接整条覆盖会让 RMS 看到「65100 → 65100」这个中间态，丢失真实起点。

```
首次入键   { original: 65159, new: 65100 }
再次同键   { original: 65100, new: 65000 }   ← 美团给的
合并结果   { original: 65159, new: 65000 }   ← 我们存的
           ↑ 保留首次        ↑ 取最新
```

### 决策 3：对账结果放 `changeRaw` 内，不动跨渠道契约

`OtaAmountChangeReport` 的顶层字段**渠道无关**（`shared/types/amount-change.ts` 文件头），
加一个只有美团才有的 `reconciliation` 会破坏这一点，且要动 `packages/api` 契约、
连带 RMS 侧改结构。

```
changeRaw
├── goodsDetails[]        ← 累积合并后的结果（形状不变，RMS 现有解析逻辑继续有效）
├── globalPricePrompt     ← 原样
└── calcUpdateCheck                 ← **新增**，本次唯一的契约变化
    ├── comparable: boolean          update 是否以绝对值表达（operateType === 6）
    ├── updateOperateTypes: number[] update 里实际出现的 operateType，去重
    └── cells[]
        ├── goodsId / startDate / endDate / inWeek
        ├── status: 'matched' | 'mismatched' | 'missing-calc' | 'not-comparable'
        ├── updateValue: string | null   update 的 operateNum（×100 字符串，原样）
        └── calcValue:  string | null    calc 素材的改后价（×100 字符串，原样）
```

⚠️ **`calcUpdateCheck` 是 desktop 计算出来的，不是美团的原始字段** —— 与
`changeRaw` 其余部分「忠实透传」的性质不同。放在同一层是为了不动跨渠道契约，代价是 RMS
侧需知道这个 key 是我们加的。已在 spec 与 payload 模型里写明。

| 候选放置 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 顶层新字段 | 语义最干净 | 破坏「顶层渠道无关」，动 `packages/api` + RMS | ❌ |
| `changeRaw.calcUpdateCheck` | 零契约变更 | 与透传语义混杂，需写明 | ✅ |
| 不上报，只记日志 | 最省事 | RMS 无从判断可信度，等于没做 | ❌ |

### 决策 4：三个模型的归属 —— 一个新建、两个扩写

本次涉及**三个**模型，性质不同，不能混在一起说：

| 模型 | 位置 | 变化 | 性质 |
|---|---|---|---|
| `MeituanCalcUpdateCheck` | `meituan/calc-update-check.ts`（**新建**） | 全新 | desktop 计算产物，RMS 要读 |
| `MeituanAmountChangeRaw` | `meituan/amount-change-payload.ts` | 扩写 | 多一个 `calcUpdateCheck?` 字段 |
| `CalcContext` | `meituan/amount-change-adapter.ts` | 扩写 | `changeRaw` → `cells[]`，仅进程内 |

#### 为什么 `MeituanCalcUpdateCheck` 单开一个文件

`amount-change-payload.ts` 现有的职责是**「描述美团发给我们的东西」**——文件头整篇在讲
「calc 响应长什么样、我们剔了什么、为什么剔」。`calcUpdateCheck` 是**我们算出来的**，
塞进去会让那份文件同时承担两种性质相反的说明，RMS 对接时也分不清哪些字段是美团的、
哪些是我们造的。

参照 `room-close-payload.ts` 的先例：一个端点一份规格文件，各自文件头写清自己的形状。

```
meituan/
├── amount-change-payload.ts     美团给的（calc 响应裁剪）        ← 扩写：挂 key + 指路
├── calc-update-check.ts      我们算的（对账结果）             ← 新建
└── room-close-payload.ts        美团给的（关房请求体）           ← 不动
```

#### ⚠️ 先厘清：新增的**字段只有一个**，三个类型是它的三层

最容易误会的地方 —— `MeituanCalcUpdateCell` **不是**新增字段，它是新增字段里
`cells` 数组每一项的类型。RMS 拿到的是一整张对账单，不是单独拿到一行。

```
changeRaw                                  已有，发给 RMS
├── goodsDetails[]                         已有
├── globalPricePrompt                      已有
└── calcUpdateCheck                        ★ 本次唯一新增的字段
    ├── comparable: boolean
    ├── updateOperateTypes: number[]
    └── cells: MeituanCalcUpdateCell[]     ← Cell 是数组元素的类型
        ├── [0] { goodsId, …, status, updateValue, calcValue }
        ├── [1] { … }
        └── [2] { … }
```

| 名字 | 是什么 | 类比 |
|---|---|---|
| `calcUpdateCheck` | **新增的那个字段** | 一张对账单 |
| `MeituanCalcUpdateCheck` | 该字段的类型 | 对账单的格式 |
| `MeituanCalcUpdateCell` | `cells` 每一项的类型 | 对账单**一行**的格式 |
| `CalcUpdateCellStatus` | 每行 `status` 的取值 | 那一行盖的章（四选一） |

三个类型同放一个文件（同一数据结构的三层，拆开要来回跳），与
`room-close-payload.ts` 的做法一致。

#### 新模型骨架

```ts
/** 一个可独立取值的最小单元 = (房型 × 日期区间 × 周次档)。 */
export type CalcUpdateCellStatus =
  | 'matched'         // calc 与 update 一致
  | 'mismatched'      // 不一致 —— calc 素材不可信
  | 'missing-calc'    // update 里有这一格，calc 里没有
  | 'not-comparable'; // update 以相对量表达，无从比

export type MeituanCalcUpdateCell = Readonly<{
  goodsId: string;
  startDate: string;
  endDate: string;
  /** 升序，与累积键一致。 */
  inWeek: readonly number[];
  status: CalcUpdateCellStatus;
  /** update 提交体的 operateNum，×100 字符串原值，不换算。无则 null。 */
  updateValue: string | null;
  /** calc 累积素材的改后价，×100 字符串原值。无则 null。 */
  calcValue: string | null;
}>;

export type MeituanCalcUpdateCheck = Readonly<{
  /** update 是否以绝对值表达（全部 operateType === 6）。 */
  comparable: boolean;
  /** update 里实际出现过的 operateType，去重升序 —— 未知码靠它暴露。 */
  updateOperateTypes: readonly number[];
  cells: readonly MeituanCalcUpdateCell[];
}>;
```

#### RMS 实际会收到什么（取自 `批量改房价-基础改价.md` 真实序列）

req0-req3 四次 calc、req5 提交 6 个价格档，其中只有 2 档有对得上的 calc 素材：

```jsonc
"calcUpdateCheck": {
  "comparable": true,              // update 全是 operateType 6，可比
  "updateOperateTypes": [6],
  "cells": [
    {
      "goodsId": "1135787306",
      "startDate": "2026-08-26", "endDate": "2026-08-29",
      "inWeek": [5, 6],
      "status": "matched",         // calc 有素材且一致 → RMS 可直接跟价
      "updateValue": "65100",
      "calcValue": "65100"
    },
    {
      "goodsId": "1135787306",
      "startDate": "2026-08-26", "endDate": "2026-08-29",
      "inWeek": [1, 2, 3, 4, 7],
      "status": "missing-calc",    // update 有这格，calc 里没有 → 不可跟价
      "updateValue": "65100",
      "calcValue": null
    }
    // …其余 4 档
  ]
}
```

RMS 侧用法：遍历 `cells`，**只有 `status: "matched"` 的行**才能拿 `updateValue`
去跟价；其余三种状态一律降级，MUST NOT 写入业务台账。

#### `MeituanAmountChangeRaw` 的扩写

```ts
export type MeituanAmountChangeRaw = JsonObject &
  Readonly<{
    goodsDetails?: readonly JsonObject[];
    globalPricePrompt?: JsonObject | null;
    /** ⚠️ desktop 计算产物，**不是美团字段**。规格见 ./calc-update-check.ts */
    calcUpdateCheck?: MeituanCalcUpdateCheck;
  }>;
```

字段可选：只有改价那条路产出它，且是提交时才挂上；calc 阶段存的 context 里没有。

#### `CalcContext` 的扩写 —— 只在进程内，不进上报体

累积语义要求 context 存的不再是「一份成品 changeRaw」，而是「按键索引的 cells」：

```ts
type CalcCell = Readonly<{
  goodsId: string;
  startDate: string;
  endDate: string;
  inWeek: readonly number[];
  /** 改前价 —— **保留首次**，见决策 2。 */
  originalSalePrice: string | null;
  /** 改后价 —— 取最新。 */
  salePrice: string | null;
  /** 该 cell 所属的 calc 响应片段，重建 goodsDetails[] 用。 */
  detail: JsonObject;
}>;

type CalcContext = Readonly<{
  otaHotelId: string;
  endpointUrl: string;
  /** 键 = `${goodsId}|${startDate}|${endDate}|${inWeek.join(',')}`，见决策 1。 */
  cells: Readonly<Record<string, CalcCell>>;
  /** 最后一次 calc 的，重建时沿用。 */
  globalPricePrompt: JsonObject | null;
}>;
```

⚠️ `CalcContext` 走机制层的 `JsonObject` 通道（`parse` 的 context 形参），所以只能用
可序列化结构 —— 不能用 `Map`，故 `cells` 是 `Record`。`isCalcContext` 的校验要跟着改，
否则旧形状的 context 会被当成合法值。

### 决策 4b：重建 `goodsDetails` 时按提交体过滤掉过期区间

**实现中发现的缺口**（决策 1 未覆盖）：用户可以在操作途中**改日期范围**，而日期是累积键
的一部分 —— 旧区间的格子不会被覆盖，而是与新区间**并存**。

`批量改房价-基础改价.md` 的真实序列就有这个情况：

```
calc①  08-27~08-28   3 格   ← 用户最初选的日期
calc②③ 08-26~08-29   2 格   ← 用户改了日期范围
提交    08-26~08-29   6 格
        ↑ 只有这个区间是用户真正提交的
```

不处理的话，上报的 `goodsDetails` 会同时含两个日期区间，其中 `08-27~08-28` 那 3 格是用户
**已经放弃**的中间状态。RMS 若只读 `goodsDetails` 不读对账结果，就会看到一个从未被提交的
日期区间。

**结论：重建 `goodsDetails` 时只保留提交体里出现过的 (goodsId × 日期区间)，过期的丢弃。**

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| A 按提交体过滤 | 上报内容与用户实际提交一致，RMS 不读对账也不会误解 | `goodsDetails` 不再是累积素材全集 | ✅ |
| B 全留，对账里加 `superseded` 状态 | 信息最全 | RMS **必须**读对账才能正确解读 `goodsDetails` | ❌ |
| C 日期变更时清空累积 | 最简单 | 误伤「先改 A 日期段再改 B 日期段」的合法场景（`高级改价` 踩点里就有），会重新引入本次要修的漏报 | ❌ |

⚠️ 过滤只按 **(goodsId × 日期区间)** 做，**不按周次档** —— 周次档在提交体里缺失是
`missing-calc` 要表达的正常情况（用户开周末差异后没重算某一档），不是过期。两者性质不同：
日期区间过期是「用户改了主意」，周次档缺失是「美团没发试算」。

### 决策 5：`operateType` 决定可比性

实测四份文档统计（`salePrice` 字段）：

| operateType | 语义 | `operateNum` | 可比对 |
|---|---|---|---|
| `6` | 直接设价 | 绝对值 ×100（`"65100"`） | ✅ 逐值比 |
| `1` | 加价 | 增量 ×100（`"100"` = +1 元） | ❌ 需原价换算，属语义转换 |
| `3` | 不改动 | `""` | ❌ 无值可比 |

`basePrice` / `subPrice` 实测恒为 `3`，只比 `salePrice`。

`operateType: 1` 时**整份**标 `comparable: false`、每个 cell 标 `not-comparable` ——
不做「部分可比」的混合口径，避免 RMS 侧解读复杂化。

### 决策 6：提交体的日期形状与 calc 响应不同，需归一后再比

```
calc 响应      unifiedDatePriceInfos { dates[], weekPriceInfos[] }   或  priceInfos[]
提交体         calcPriceUnifiedDateModel { dates[], calcPriceWeekModels[] }
```

字段名不同（`weekPriceInfos` vs `calcPriceWeekModels`、`priceInfo.salePrice` vs
`calcPriceInfo.salePrice.operateNum`），但 `(dates × inWeek)` 的组合语义一致。对账前各自
展开成 `Map<键, 值>` 再比 —— **归一只发生在对账内部**，`changeRaw.goodsDetails` 仍是
calc 响应的原始形状。

### 决策 7：清空时机 = 上报那一刻，且清在机制层

`createFlag: true` 且已产出 report 后立即清空累积。不在 `createFlag: false`（预检）时清
—— 用户可能在弹窗点取消后继续改。

```
calc ×N        累积
update false   不动     ← 预检，用户可能取消（parse 返回 null，context 原样保留）
update true    上报 → 清空
```

⚠️ **清空动作落在机制层**（`amount-save-capture.ts` 的 `handleFinished`：产出 report 后
`this.context = null`），不在适配器里。

| 放哪 | 可行性 |
|---|---|
| 适配器 | ❌ 适配器**无状态**（三渠道共用一份实例），`parse` 交出 report 后没有再碰这份状态的机会 |
| 机制层 | ✅ context 本来就存在这里；「一次上报消费掉一份上下文」是渠道无关的规则，不需要适配器表态 |

这是本次**唯一**的机制层改动。预检路径不受影响：`parse` 返回 `null` 时机制层直接 return，
`context` 原样保留。

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| 累积键漏一个维度导致误覆盖，失效方式是**静默少报** | 单测钉住踩点里的四条真实序列；`高级改价` 的同房型多日期段是关键用例 |
| 用户切门店但未离开页面 → 累积混入两家门店的素材 | **实现时改为在试算阶段就重置**：`poiId` 与已累积的不一致时直接从零开始累积并记 info。比原计划的「提交时过滤」更早拦住，且不必给每个格子都带 `poiId` |
| 页面会话长、累积无上限 → 内存增长 | 累积项数量级 = 房型 × 日期段 × 周次档，实测个位数；设上限 500 项，超限丢最早并记 warn |
| `calcUpdateCheck` 被 RMS 误当成美团原始字段 | payload 模型文件头 + spec 均写明是 desktop 计算产物 |
| 提交体出现未见过的 `operateType` | `comparable: false` + 原值记入 `updateOperateTypes`，不臆造结论 |
| **对账"不符"的真实含义未经真机确认** | 日历页那条（calc 47100→47000、submit 47100）是文档推断的漂移，须真机复现确认不是踩点遗漏 |

## Migration Plan

纯 desktop 端改动，无数据迁移。RMS 侧在 desktop 发版前需能容忍 `changeRaw` 多一个
`calcUpdateCheck` key（只增不改，现有解析不受影响）；消费它可后置。

回滚：还原 `parse` 的 context 处理即可，无持久化状态。

## Open Questions

- `operateType` 的完整取值表（已知 1/3/6，是否有减价、按比例等其它码）—— 不影响本次实现：
  未知码一律 `comparable: false`。踩清后可扩展可比范围。
- RMS 侧对 `mismatched` / `missing-calc` 的具体降级策略 —— 属服务端职责，desktop 只负责
  如实标注。
