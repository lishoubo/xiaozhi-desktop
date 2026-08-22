# 美团改价上报 —— 服务端对接说明

> 对应 change `extend-meituan-price-status-coverage`。
> 字段级规格的事实来源是 desktop 侧的 `calc-update-check.ts` 与 `amount-change-payload.ts`，
> 本文是给服务端的摘要与工作清单。

## 一句话

**`changeRaw` 多了一个 `calcUpdateCheck` —— 它告诉你这次上报的价格里哪些可信、哪些不可信。**
契约顶层零改动，现有解析逻辑不改也能跑（只是会漏掉这个判断依据）。

## 为什么会有不可信的价格

美团的改价请求体只说「卖价 +1 元」不说原价，所以 desktop 上报的是**试算**（`calcPriceV2`）
的结果而不是提交体 —— 这一点没变。变的是我们发现试算与提交**可能对不上**：

| 偏离 | 怎么发生的 | 后果 |
|---|---|---|
| **漏算** | 美团只为用户当次触碰的部分发试算，其余档没有素材 | 少报 |
| **漂移** | 用户填了价触发试算，又改回去直接提交，美团没再发试算 | ⚠️ **报了一个从未生效过的价格** |

漂移是真实踩点样本（`房价房量日历踩点.md`）：试算说「471 → 470」，提交体设的是 **471**。
按老逻辑上报，RMS 会按 470 跟价 —— 这个价格从来没有生效过。

⚠️ **这是本次改动的首要动机**：漏报只是少数据，报错价会让渠道间价格不一致。

## 服务端要做什么

### 必做：按 `calcUpdateCheck.cells[].status` 分流

```
matched          ✅ 可直接跟价
mismatched       ❌ 不可跟价 —— 试算素材已过时
missing-calc     ❌ 不可跟价 —— 这一档没有试算素材
not-comparable   ❌ 不可跟价 —— 提交用的是相对量（加价），无从比对
```

**只有 `matched` 的格子能写入业务台账**，其余三种一律降级（跳过、告警、人工复核，由你们定）。

⚠️ **不做这个分流的后果**：`changeRaw.goodsDetails` 里躺着的仍是试算价，其中一部分是错的。
不看 `calcUpdateCheck` 就等于按老逻辑跟价，漂移那种情况会静默跟错。

### 一格（cell）是什么

`(goodsId × 日期区间 × 周次档)` 的组合 —— **不是房型**。开了「周末差异定价」时同一房型的
工作日与周末是两格，各有各的价：

```
goodsId 1135787306 × 2026-08-26~2026-08-29 × [1,2,3,4,7]   一格
goodsId 1135787306 × 2026-08-26~2026-08-29 × [5,6]         另一格
```

`inWeek` 是数字数组，**1=周一 … 7=周日**（与抖音同，与携程的位串/英文枚举不同）。

## 报文长什么样

```jsonc
"changeRaw": {
  "goodsDetails": [ /* 试算素材，形状不变 —— 现有解析逻辑继续有效 */ ],
  "globalPricePrompt": { },
  "calcUpdateCheck": {                    // ★ 新增
    "comparable": true,                   // 提交是否以绝对值表达
    "updateOperateTypes": [6],            // 提交里出现过的 operateType
    "cells": [
      {
        "goodsId": "1135787306",
        "startDate": "2026-08-26", "endDate": "2026-08-29",
        "inWeek": [5, 6],
        "status": "matched",              // ✅ 可用
        "updateValue": "65100",           // 提交侧的值
        "calcValue": "65100"              // 试算侧的值
      },
      {
        "goodsId": "1135787306",
        "startDate": "2026-08-26", "endDate": "2026-08-29",
        "inWeek": [1, 2, 3, 4, 7],
        "status": "missing-calc",         // ❌ 没有试算素材
        "updateValue": "65100",
        "calcValue": null
      }
    ]
  }
}
```

**金额一律是 ×100 的字符串**：`"65100"` = 651.00 元。两侧都是原值，desktop 不换算。

⚠️ `not-comparable` 时 `updateValue` 与 `calcValue` **量纲不同**（一个是增量、一个是绝对
价），**不要相减或比较**。两个值都留着只为留痕。

## 几个容易踩的点

**1. `calcUpdateCheck` 是 desktop 算出来的，不是美团的字段。**
`changeRaw` 其余内容都是渠道原始数据的忠实透传，只有这一个 key 是我们加的。放在同一层是
为了不动跨渠道契约（顶层字段三渠道共用）。

**2. `goodsDetails` 里的房型可能比 `cells` 少。**
用户中途改日期范围时，被放弃的日期区间会从 `goodsDetails` 里滤掉，但提交体里的那些格子
仍会出现在 `cells` 里（标 `missing-calc`）。**以 `cells` 为准** —— 它才是用户实际提交的
范围。

**3. `changeRaw` 不要摊平。**
美团房量端点的请求体里有个自己的 `changeType` 字段（数字），摊平会覆盖掉上报体顶层我们
的 `changeType: 'price'`。这条不是本次新增的风险，但一并提醒。

**4. 上报仍然是「渠道确认成功」才发。**
对账结果**不改变是否上报** —— desktop 只当探针，`mismatched` 也照发，判断留给你们。

## 契约变化清单

| 项 | 变化 |
|---|---|
| `OtaAmountChangeReport` 顶层字段 | ✅ 零改动 |
| `changeType` 枚举 | ✅ 零改动（仍是 `price`） |
| `endpointId` | ✅ 零改动（仍是 `calcPriceV2`） |
| `changeRaw.goodsDetails` 形状 | ✅ 兼容 —— 统一用 `priceInfos[]`（形状②），本就是两种形状之一 |
| `changeRaw.calcUpdateCheck` | ⚠️ **新增**，只增不改 |

⚠️ `goodsDetails` 的日期形状现在**统一是 `priceInfos[]`**（`unifiedDatePriceInfos` 恒为
`null`）。两种形状 RMS 本来就都要认，所以不算破坏性变化 —— 但如果你们只实现了
`unifiedDatePriceInfos` 那一支，**需要补上 `priceInfos[]` 的解析**。

## 上线顺序

`calcUpdateCheck` 是只增字段，desktop 先发不会打破现有解析。建议：

1. 服务端先容忍这个多出来的 key（多数 JSON 解析器默认忽略未知字段，通常无需改动）
2. desktop 发版
3. 服务端再实现 `status` 分流

第 3 步之前，漂移场景仍会跟错价 —— 与现状持平，不会更糟。
