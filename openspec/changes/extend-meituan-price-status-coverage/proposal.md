## Why

美团批量改价页的 `calcPriceV2` **只重算用户当次触碰的那部分**（房型 × 日期段 × 周次档），而当前实现把每条试算当整体覆盖、提交时只上报最后一条。踩点实测：一次改了 3 个房型共 6 个价格档的操作，上报只覆盖 1 个房型。

另有一个同源缺陷：美团有**两种改价模式**，提交体形状不同（`calcPriceUnifiedDateModel` / `calcPriceModels`），现有实现只认前者 —— 走「日期分开改价」时上报的 `goodsDetails` **整条为空**。

## What Changes

- `calcPriceV2` 素材由「整条覆盖」改为**按 (goodsId × 日期区间 × 周次档) 累积、同键后到覆盖先到**；提交时把累积结果合并成一份 `goodsDetails[]` 上报。
- 同键覆盖时**保留首次的改前价**（`originalPriceInfo`）—— 第二次试算的「改前价」已是第一次的结果，直接覆盖会让 RMS 看到中间态。
- 提交时按 `updatePriceV2` 请求体里出现过的 (goodsId × 日期区间) 过滤掉用户中途放弃的旧日期段；**两种提交体形状都要认**。
- **不做 calc/update 对账**（方案中途取消）：服务端明确不消费，且判断素材可信度需要卖价+底价+佣金率三元组，不是探针的职责。
- 上报后清空累积，避免带进下一次改价。
- **不改**关房链路：`deductRoomCount` 仍不拦。经用户确认，日历页关房同样先发 `submitaudit`，现有覆盖正确（2026-08-14 已真机验证）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `ota-amount-change-report`：新增「跨请求累积的改动素材」这一类观测模式的契约 —— 渠道分多次请求逐步构造一次改动时，系统按语义键累积而非整体覆盖。现有「美团改价可被观测」的相关行为随之细化。**上报字段零新增。**

## Impact

- `apps/desktop/src/main/channels/meituan/amount-change-adapter.ts`：`parse` 的 context 语义由覆盖改为累积 + 上报后清空。
- `apps/desktop/src/main/channels/meituan/calc-update-check.ts`：**删除**（对账方案取消）。
- `apps/desktop/src/main/channels/meituan/amount-change-payload.ts`：改价模式判定（`detectMeituanPriceMode`）、累积键提取、同键合并与模式 A 的按 `goodsId` 整条覆盖、`goodsDetails[]` 重建、模式 A 提交时按 `goodsList` 裁房型（`dropRoomTypesNotSubmitted`）。
- `packages/api/`：**不改** —— 上报契约在 `apps/desktop/src/shared/types/amount-change.ts`，`changeRaw` 形状零变化。
- 单测：`meituan-amount-change-adapter.test.ts`、`meituan-amount-change-payload.test.ts`。
- **RMS 侧**：**零改动**。`changeRaw` 形状不变，只是 `goodsDetails` 内容变多（以前漏收的房型进来）。
- 机制层（`amount-save-capture.ts`）**不改** —— `parse` 的 context 契约本就把内容语义完全交给适配器。
