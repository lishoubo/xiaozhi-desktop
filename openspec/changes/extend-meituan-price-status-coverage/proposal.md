## Why

美团批量改价页的 `calcPriceV2` **只重算用户当次触碰的那部分**（房型 × 日期段 × 周次档），而当前实现把每条试算当整体覆盖、提交时只上报最后一条。踩点实测：一次改了 3 个房型共 6 个价格档的操作，上报只覆盖 1 个房型。更严重的是试算与提交可能不一致（用户改完数值不再触发试算），此时上报的是一个**从未被提交的价格**，RMS 会按错价跟价。

## What Changes

- `calcPriceV2` 素材由「整条覆盖」改为**按 (goodsId × 日期区间 × 周次档) 累积、同键后到覆盖先到**；提交时把累积结果合并成一份 `goodsDetails[]` 上报。
- 同键覆盖时**保留首次的改前价**（`originalPriceInfo`）—— 第二次试算的「改前价」已是第一次的结果，直接覆盖会让 RMS 看到中间态。
- 提交（`createFlag: true`）时用 `updatePriceV2` 请求体对累积结果做一次**对账**，结果随上报一并发给 RMS：逐档标出「有试算素材且与提交一致」「有素材但与提交不符」「提交了但无素材」三种状态。仅在 `operateType: 6`（直接设价，绝对值）时可比对；`operateType: 1`（加价，相对值）与 `3`（不改）无法比对，如实标注。
- 上报后清空累积，避免带进下一次改价。
- **不改**关房链路：`deductRoomCount` 仍不拦。经用户确认，日历页关房同样先发 `submitaudit`，现有覆盖正确（2026-08-14 已真机验证）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `ota-amount-change-report`：新增「跨请求累积的改动素材」这一类观测模式的契约 —— 渠道分多次请求逐步构造一次改动时，系统按语义键累积而非整体覆盖，并在提交时对账、把对账结果一并上报。现有「美团改价可被观测」的相关行为随之细化。

## Impact

- `apps/desktop/src/main/channels/meituan/amount-change-adapter.ts`：`parse` 的 context 语义由覆盖改为累积 + 提交时对账、清空。
- `apps/desktop/src/main/channels/meituan/calc-update-check.ts`：**新增**，对账结果模型（`MeituanCalcUpdateCheck` 等三个类型）+ 规格说明。
- `apps/desktop/src/main/channels/meituan/amount-change-payload.ts`：累积键提取、同键合并、`goodsDetails[]` 重建；`MeituanAmountChangeRaw` 加可选字段 `calcUpdateCheck`。
- `packages/api/`：**不改** —— 上报契约在 `apps/desktop/src/shared/types/amount-change.ts`，且对账结果放 `changeRaw` 内，顶层字段零变化（见 design.md 决策 3、4）。
- 单测：`meituan-amount-change-adapter.test.ts`、`meituan-amount-change-payload.test.ts`。
- **RMS 侧**：需能读取对账结果，并对「提交了但无素材」「素材与提交不符」的档做降级处理（不可当作确定价格跟价）。
- 机制层（`amount-save-capture.ts`）**不改** —— `parse` 的 context 契约本就把内容语义完全交给适配器。
