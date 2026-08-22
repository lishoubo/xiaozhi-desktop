# 美团改价上报 —— 服务端对接说明

> 对应 change `extend-meituan-price-status-coverage`。
> 字段级规格的事实来源是 desktop 侧的 `amount-change-payload.ts`，本文是给服务端的摘要。
>
> **本文已按服务端 2026-08-22 的 `client-feedback.md` 修订** —— 上一版要求的
> 「按 `calcUpdateCheck.cells[].status` 分流」**已取消**，见下。

## 一句话

**服务端零改动。** 本次是纯 desktop 端修复：以前一次改多个房型只上报其中一个，现在全部
上报。`changeRaw` 形状不变，`goodsDetails` 内容变多。

## 契约变化清单

| 项 | 变化 |
|---|---|
| `OtaAmountChangeReport` 顶层字段 | ✅ 零改动 |
| `changeType` 枚举 | ✅ 零改动（仍是 `price`） |
| `endpointId` | ✅ 零改动（仍是 `calcPriceV2`） |
| `changeRaw` 形状 | ✅ 零改动 —— **不新增任何字段** |
| `changeRaw.goodsDetails` 内容 | ⚠️ **变多**，见下 |

## 唯一需要知道的：`goodsDetails` 会变多

美团的 `calcPriceV2` **只重算用户当次触碰的那部分**，不是每次都带全量。老实现整条覆盖
上一次试算，导致：

```
用户改了 3 个房型共 6 个价格档
  calc①  房型 A、B、C   ← 初次勾选
  calc②  房型 A         ← 开周末差异定价
  calc③  房型 C         ← 改第三个房型
  提交                  ← 老实现上报的是 calc③，只有房型 C
```

**修复后按 (goodsId × 日期区间 × 周次档) 累积**，提交时把全部格子一起发出去。

| 项 | 服务端影响 |
|---|---|
| `goodsDetails` 形状 | 不变，无需改动 |
| `goodsDetails` 内容变多 | ✅ 期望行为 —— 以前漏掉的房型会进来 |
| 上报量上涨 | ✅ 是修复漏收的结果，不是故障 |

服务端已在 `client-feedback.md` §4.5 确认此项赞成、照常发版。

## ⚠️ 已取消：`calcUpdateCheck` 对账字段

上一版本文要求服务端按 `calcUpdateCheck.cells[].status` 分流跟价。**该字段已从方案中
整体删除**，不会出现在报文里。取消理由：

1. **服务端明确不消费**（`client-feedback.md` §1）：改价解析照常读 `goodsDetails`、
   全部格子照常跟价。
2. **desktop 不该复现美团的定价计算**。判断「这个价可不可信」需要卖价 + 底价 + 佣金率
   三元组（`client-feedback.md` §5.1），只比 `salePrice` 一项得出的结论不可靠。这是 RMS
   的职责，不是探针的。

服务端反馈 §2 指出「漂移」的踩点依据不成立（`房价房量日历踩点.md` 整段只有一次
`calcPriceV2`，大概率是漏抄而非美团没发）—— **这一点成立**，原方案据此把漂移定性为
「首要动机」是超出证据的，相关措辞已一并删除。

## 几个容易踩的点

**1. `goodsDetails` 的日期形状统一是 `priceInfos[]`**（`unifiedDatePriceInfos` 恒为
`null`）。服务端已确认两种形状本来就都认，无需补。

**2. 一格不是房型。** `(goodsId × 日期区间 × 周次档)` 才是最小单位 —— 开了「周末差异
定价」时同一房型的工作日与周末是两格，各有各的价：

```
goodsId 1135787306 × 2026-08-26~2026-08-29 × [1,2,3,4,7]   一格
goodsId 1135787306 × 2026-08-26~2026-08-29 × [5,6]         另一格
```

`inWeek` 是数字数组，**1=周一 … 7=周日**（与抖音同，与携程的位串/英文枚举不同）。
服务端已确认 `ChangeSpec.Group` 模型支持。

**3. `changeRaw` 不要摊平。** 美团房量端点的请求体里有个自己的 `changeType` 字段
（数字），摊平会覆盖掉上报体顶层的 `changeType: 'price'`。服务端已确认从未摊平。

**4. 金额一律是 ×100 的字符串**：`"65100"` = 651.00 元。desktop 不换算、不做单位归一。

**5. 上报仍然是「渠道确认成功」才发。** desktop 只当探针，不做准入判断。

## 上线顺序

**无需协调。** 本次不新增字段、不改形状，desktop 可独立发版，服务端不需要做任何准备。
