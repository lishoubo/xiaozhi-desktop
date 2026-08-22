## Context

见 `proposal.md` §Why。本节只列决定方案形状的既有约束。

**现状**：`meituan/amount-change-adapter.ts` 的 `parse` 对 `calcPriceV2` 返回
`{ kind: 'context' }`，机制层（`amount-save-capture.ts`）**整条替换**上一份 context；
`updatePriceV2` 且 `createFlag: true` 时取出该 context 作为 `changeRaw` 上报。

**两层数据，只有一层出得去** —— 后面的决策反复提到这两者，先厘清边界：

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
                          │  ├ goodsDetails[]      │     形状不变，只是内容变全
                          │  └ globalPricePrompt   │
                          └───────────┬────────────┘
                                      ▼  POST /api/v1/app/ota-changes
                                     RMS
```

① 换结构对 RMS **完全无感**（它看不到）；② 才是契约面 —— 而本次②的**形状也不变**，
只是内容从「最后一次 calc」变成「累积的全部 calc」。

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
| `changeRaw` 之外的上报字段**渠道无关** | `shared/types/amount-change.ts` | 本次不新增任何上报字段 |
| desktop 只当探针，不解读语义 | `openspec/specs/ota-amount-change-report` | 只做合并，不判断价格对不对 —— 那是 RMS 的事 |

## Goals / Non-Goals

**Goals:**
- 累积覆盖用户实际触碰过的全部 (房型 × 日期区间 × 周次档)
- 覆盖美团的**两种改价模式**（基础/日历、高级），两者提交体形状不同
- 上报后清空，不跨改动泄漏

**Non-Goals:**
- **不改关房链路**。`deductRoomCount` 仍不拦 —— 已确认日历页关房同样先发 `submitaudit`
  （2026-08-14 真机验证：关房只产生一条上报）。本次零改动。
- **机制层只动「上报即清空 context」一处**（实现时修正，原计划零改动）。理由见决策 6：
  适配器无状态、交出 report 后没有再碰状态的机会，而「一次上报消费掉一份上下文」是渠道
  无关的规则。除此之外 `amount-save-capture.ts` 不动。
- **不做语义换算**。素材原样透传，不把 `operateType: 1`（加价）换算成绝对值。
- **不做 calc/update 对账**。desktop 不复现美团的定价计算，也不判断素材可不可信 ——
  见决策 3。
- **不认 `/product/price/unified/calcPriceV2`**。见决策 3b。

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

### 决策 3：不做 calc/update 对账 —— desktop 只合并，不判断

**这一条是方案中途改的**，原设计有一整套 `calcUpdateCheck` 对账模型（四种 status、
可比性判定、逐格比对）。取消理由有二：

1. **服务端明确不消费**（`xiaozhi-rms-workspace` 的 `client-feedback.md` §1）：改价解析
   照常读 `goodsDetails`、全部格子照常跟价，对账结果只随 `raw_body` 落库留痕。
2. **desktop 不该复现美团的定价计算**。判断「这个价可不可信」需要卖价 + 底价 + 佣金率
   三元组，全部来自试算响应；只比 `salePrice` 一项得出的结论没有意义。这是 RMS 的职责，
   不是探针的。

**结论：`calcPriceV2` 只做合并，`updatePriceV2` 成功即上报累积素材。**

```
calcPriceV2    →  合并进累积（不判断、不对账、不分流）
updatePriceV2  →  确认成功 → 发出累积素材 → 清空
```

删除的产物：`calc-update-check.ts` 整个文件、`changeRaw.calcUpdateCheck` 字段、
`extractUpdateCells()`、`comparable` / `operateType` 可比性判定、四种 status、对应单测。

| 候选 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 对账并按 status 分流 | 理论上能挡住不可信素材 | 服务端不消费；三元组不全，结论不可靠；复杂度高 | ❌ |
| 对账但只留痕 | 排查时可查 | 无消费方，纯自证自话 | ❌ |
| **只合并，不对账** | 简单；与 desktop「只当探针」的定位一致 | 脏素材由 RMS 端识别 | ✅ |

⚠️ 契约影响：本次**不新增任何上报字段**。`changeRaw` 形状与改动前完全一致，
RMS 侧零改动、无需等待 desktop 发版。

### 决策 3b：不认 `/product/price/unified/calcPriceV2`

`批量改房价-高级改价.md` 里出现了一个未见过的端点，与已认的 `separate/calcPriceV2`
**结构不同**：

```
unified/calcPriceV2                       separate/calcPriceV2
├── calcPriceModels  ← 顶层，全房型共享     ├── goodsList[]
└── goodsList[]  ← 扁平房型清单，无         │   └── { goodsBaseInfo, calcPriceModels }
    goodsBaseInfo、无 calcPriceModels      └── 一次带一个房型
```

它的 `salePrice.operateType` 全是 **3（不改动）**，`operateNum` 为空 —— 是用户刚选完
房型和日期、尚未填价时，页面用来铺当前价的**查询**请求，不表达改价意图。

**核对过是否会丢信息**（`高级改价` 踩点逐格比对）：

```
#0 unified   787306 09-08~09 wk=[1..7]  original=55057  sale=55057   ← 取当前价
#1 separate  787306 09-08~09 wk=[2,3]   original=55057  sale=55157   ← 用户加价 1 元
                                        ↑ separate 自带的改前价与 unified 完全一致
```

`separate` 每格自带 `originalPriceInfo`，值就是原价。**不认 `unified` 不丢任何信息**，
认了反而会往累积里塞 4 个 `operateType: 3` 的假改价格子（上报成「改成原价」）。

| 候选 | 结论 |
|---|---|
| 认，直接合并 | ❌ 上报混入假改价格子 |
| 认，跳过 `operateType: 3` | ❌ 为零收益引入分流逻辑 |
| **不认**（维持现状，零改动） | ✅ `separate` 已覆盖全部所需信息 |


### 决策 4：重建 `goodsDetails` 时按提交体过滤掉过期区间

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
**已经放弃**的中间状态 —— RMS 会看到一个从未被提交的日期区间。

**结论：重建 `goodsDetails` 时只保留提交体里出现过的 (goodsId × 日期区间)，过期的丢弃。**

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| A 按提交体过滤 | 上报内容与用户实际提交一致 | `goodsDetails` 不再是累积素材全集 | ✅ |
| B 全留，另加标记区分 | 信息最全 | 需要 RMS 读懂额外标记才能正确解读 `goodsDetails` | ❌ |
| C 日期变更时清空累积 | 最简单 | 误伤「先改 A 日期段再改 B 日期段」的合法场景（`高级改价` 踩点里就有），会重新引入本次要修的漏报 | ❌ |

⚠️ 过滤只按 **(goodsId × 日期区间)** 做，**不按周次档** —— 周次档在提交体里缺失是正常
情况（用户开周末差异后没重算某一档），不是过期。两者性质不同：日期区间过期是「用户改了
主意」，周次档缺失是「美团没发试算」，后者的素材仍然有效。

⚠️ 提交体的日期有**两种挂载位置**（决策 5），`submittedGoodsDateKeys()` 两种都必须读 ——
只读一种会让另一种模式下 `keep` 为空集，把全部格子裁光。

### 决策 5：提交体有**两种形状**，取决于改价模式

⚠️ **原决策 6 只列了「calc 响应 vs 提交体」的字段名差异，漏掉了「同一侧的两种模式」
这一维** —— 实现据此只认了一种形状，导致高级模式上报为空（见下）。

形状**随改价模式走，不随端点走**。同一模式下 calc 与 update 用同一套字段名，
update 只是 calc 的子集（砍掉 `priceInfos` / `pricePrompt` / `realPriceInfos` 等
只有试算才需要的字段）：

```
模式 A「统一日期」 calcPriceUnifiedDateModel      日期在外层，所有日期段共享周次档
  { dates: [{08-26~08-29}, {09-09~10-08}],
    calcPriceWeekModels: [{inWeek:[1,2,3,4,7], …}, {inWeek:[5,6], …}] }

模式 B「日期分开」 calcPriceModels[]              日期在里层，每段各带各的价
  [ { startDate:09-08, endDate:09-09, calcPriceWeekModels:[{inWeek:[2,3], …}] },
    { startDate:09-10, endDate:09-11, calcPriceWeekModels:[{inWeek:[4,5], …}] } ]
```

| 页面入口 | 模式 | calc 请求 | update 提交体 |
|---|---|---|---|
| 批量改价（基础） | A | `calcPriceUnifiedDateModel` | `calcPriceUnifiedDateModel` |
| 日历页改价 | A | `calcPriceUnifiedDateModel` | `calcPriceUnifiedDateModel` |
| 批量改价 →「日期分开改价」 | **B** | **`calcPriceModels`** | **`calcPriceModels`** |

三份踩点均已实证（`基础改价` / `日历踩点` 为 A，`高级改价` 为 B，含 update 样本）。

**缺陷**：`submittedGoodsDateKeys()` 只读 `calcPriceUnifiedDateModel`，遇模式 B 全程
落空 → `keep` 为空集 → `rebuildGoodsDetails` 裁光全部格子 → **`goodsDetails` 上报为空，
高级模式改价整条静默丢失**。回放 `高级改价` 真实序列实测复现：

```
separate/calcPriceV2 ×4   →  累积 4 格，改前价/改后价/房型/日期段/周次档齐全  ✅
updatePriceV2             →  keep=0  goodsDetails=0                        ❌
```

**修法**：`submittedGoodsDateKeys()` 加 `calcPriceModels[]` 分支（日期挂在每段里）。
归一后往下的逻辑不动 —— 这与 calc **响应**侧 `unifiedDatePriceInfos` vs `priceInfos[]`
是同一个二元对立，响应侧已经这么处理，请求侧漏做了。

⚠️ **教训：判据要落在「模式」而不是「端点」上。** 本次两个缺陷（形状漏认、`unified`
端点）都源于拿端点当判据。


### 决策 6：清空时机 = 上报那一刻，且清在机制层

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
| **提交体出现第三种形状** | 判据落在「模式」而非端点上（决策 5）；两种已知形状各有踩点实证，新形状会以 `keep` 为空暴露 —— 单测钉住两种形状，真机验证覆盖两个入口 |
| 未来出现新的 calc 端点（如 `unified`） | 白名单精确匹配，不认即无副作用；判断是否该认时先看 `operateType` 是否表达改价意图（决策 3b） |

## Migration Plan

纯 desktop 端改动，无数据迁移，**无契约变更** —— `changeRaw` 形状与改动前一致，
RMS 侧零改动、无需协调发版顺序。上线后 `goodsDetails` 内容会变多（以前漏掉的房型进来），
这是修复漏收的预期结果，服务端已知悉（`client-feedback.md` §4.5）。

回滚：还原 `parse` 的 context 处理即可，无持久化状态。

## Open Questions

- `/product/price/unified/calcPriceV2` 是否只在页面初始化时发一次 —— 目前仅一份踩点。
  不影响本次实现（不认它，零改动），但若将来发现它在别的时机带真实改价意图（`operateType`
  非 3），需重新评估决策 3b。
- 是否还有第三种改价模式/提交体形状 —— 已知两种均有踩点实证，暂无迹象存在第三种。
