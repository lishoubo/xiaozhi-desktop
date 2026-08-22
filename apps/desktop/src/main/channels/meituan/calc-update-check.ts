/**
 * 美团改价的 **calc 与 update 对照结果** —— **RMS 侧判断改价素材可不可信时读这一份**。
 *
 * 数据来源：踩点 `docs/踩点/美团/批量改房价-基础改价.md`、`批量改房价-高级改价.md`、
 * `房价房量日历踩点.md`（2026-08-22 逐份比对提交体与试算响应得出）。
 *
 * ============================================================================
 * ⚠️ 一句话摘要：这是 desktop **算出来的**，不是美团的原始字段
 * ============================================================================
 *
 * `changeRaw` 里其余内容都是「忠实透传」的渠道原始数据，**只有 `calcUpdateCheck` 是我们
 * 自己算的**。它挂在同一层是为了不动跨渠道契约（上报体顶层字段三渠道共用，加一个美团专属
 * 字段会破坏这一点），代价就是 RMS 侧必须知道这个 key 的性质与旁边那些不同。
 *
 * ## 为什么需要对账：上报的内容与用户提交的内容**可能不是一回事**
 *
 * 美团改价要跨两个请求才凑得齐信息（详见 `./amount-change-payload.ts`）：
 *
 * ```
 * calcPriceV2    响应含「改前 189.66 → 改后 190.66」  ← changeRaw.goodsDetails 就是它
 * updatePriceV2  提交体只说「设为 191.00」            ← 用户真正提交的
 * ```
 *
 * 两者**不保证一致**，有两种真实的偏离（都在踩点里出现过）：
 *
 * ```
 * ① 漏算   用户改了 A、B、C 三个房型，美团只为被触碰的那个发 calc
 *          → 提交里有 6 档，calc 素材只覆盖 2 档          → missing-calc
 *
 * ② 漂移   用户填 470（触发 calc：471 → 470），又改回 471 直接提交
 *          → calc 说改成 470，实际提交的是 471            → mismatched
 *          （`房价房量日历踩点.md` 的真实样本）
 * ```
 *
 * ⚠️ ② 比 ① 危险得多：照发 calc 素材会让 RMS 按一个**从未生效过的价格**去跟价。
 * ① 只是少报，② 是**报错**。
 *
 * ## 对账**不改变是否上报**
 *
 * 只要美团确认这次改价成功，就照常上报 —— 对账结果是交给 RMS 的**判断依据**，不是
 * desktop 的准入门槛。desktop 只当探针，「这个价能不能用」由 RMS 自己定。
 *
 * ============================================================================
 * 结构
 * ============================================================================
 *
 * ```
 * changeRaw
 * ├── goodsDetails[]        累积合并后的 calc 素材（忠实透传，形状不变）
 * ├── globalPricePrompt     calc 的，原样
 * └── calcUpdateCheck       ★ 本模型 —— desktop 计算产物
 *     ├── comparable            update 是否以绝对值表达，整份一个结论
 *     ├── updateOperateTypes[]  update 里实际出现的 operateType，去重升序
 *     └── cells[]               逐格对照，一格 = (房型 × 日期区间 × 周次档)
 *         ├── goodsId / startDate / endDate / inWeek   定位
 *         ├── status                                   ← RMS 据此决定用不用
 *         ├── updateValue                              update 侧的值
 *         └── calcValue                                calc 侧的值
 * ```
 *
 * ## 一格（cell）是什么
 *
 * 美团一次改价可以同时涉及多个房型、多个日期区间、多个周次档，**每个组合可以有各自的
 * 价格**（开了「周末差异定价」时同一房型的工作日与周末就是两格）。所以对照的最小单位是
 * 三者的组合，不是房型：
 *
 * ```
 * goodsId 1135787306 × 2026-08-26~2026-08-29 × [1,2,3,4,7]   一格
 * goodsId 1135787306 × 2026-08-26~2026-08-29 × [5,6]         另一格
 * ```
 *
 * `inWeek` 是数字数组，**1=周一 … 7=周日**（与抖音同，与携程的位串/英文枚举不同），
 * 本模型里统一**升序**输出。
 *
 * ============================================================================
 * 逐字段含义
 * ============================================================================
 *
 * | 字段 | 类型 | 含义 | 何时为 null / 空 |
 * |---|---|---|---|
 * | `comparable` | boolean | update 是否全部以**绝对值**表达价格，整份一个结论 | 不会为空 |
 * | `updateOperateTypes` | number[] | update 里实际出现过的 `operateType`，去重升序 | 不会为空 |
 * | `cells[].goodsId` | string | 售卖商品 ID（= RMS 台账的 `ota_sale_room_type_id`） | 不会为空 |
 * | `cells[].startDate` / `endDate` | string | 日期区间，`YYYY-MM-DD`，闭区间 | 不会为空 |
 * | `cells[].inWeek` | number[] | 周次档，1=周一…7=周日，升序 | 不会为空 |
 * | `cells[].status` | 见下 | 这一格的素材可不可信 | 不会为空 |
 * | `cells[].updateValue` | string \| null | **update 侧**的 `operateNum`，×100 字符串原值 | `operateType` 为 3（不改动）时为 `""`，取不到时 null |
 * | `cells[].calcValue` | string \| null | **calc 侧**的改后价，×100 字符串原值 | 该格没有 calc 素材时 null |
 *
 * ⚠️ **金额一律是 ×100 的字符串**：`"65100"` = 651.00 元。两侧都是原值，desktop **不换算、
 * 不做单位归一** —— 换算属于语义转换，由 RMS 做（`Number(v) / 100`）。
 *
 * ## 四种 status 的判定依据与 RMS 用法
 *
 * | status | 何时产生 | RMS 该怎么办 |
 * |---|---|---|
 * | `matched` | 该格有 calc 素材，且 `calcValue === updateValue` | ✅ **唯一可直接跟价的** |
 * | `mismatched` | 该格有 calc 素材，但两值不等（上面的②漂移） | ❌ 不可跟价 —— calc 素材已过时 |
 * | `missing-calc` | update 里有这一格，累积的 calc 素材里没有（上面的①漏算） | ❌ 不可跟价 —— 无改后价可用 |
 * | `not-comparable` | `comparable` 为 false，即 update 非绝对值表达 | ❌ 不可跟价 —— 无从比对 |
 *
 * **只有 `matched` 的格子能拿 `updateValue`（或等值的 `calcValue`）写入业务台账**，
 * 其余三种一律降级处理。降级的具体策略（跳过、告警、人工复核）由 RMS 侧决定。
 *
 * ⚠️ `comparable: false` 时**所有** cell 都是 `not-comparable`，不做「部分可比」的混合
 * 口径 —— 那会让 RMS 侧的解读复杂化而没有收益。
 *
 * ## `operateType` 已知取值（决定可比性）
 *
 * update 提交体里 `calcPriceInfo.salePrice.operateType` 的取值，四份踩点实测：
 *
 * | 值 | 语义 | `operateNum` | 可比对 |
 * |---|---|---|---|
 * | `6` | 直接设价 | **绝对值** ×100（`"65100"`） | ✅ 唯一可比的 |
 * | `1` | 加价 | 增量 ×100（`"100"` = +1 元） | ❌ 要用原价换算才能比，属语义转换 |
 * | `3` | 不改动 | `""` | ❌ 无值可比 |
 * | 其它 | **未踩到** | — | ❌ 一律按不可比处理 |
 *
 * 只看 `salePrice` 的 `operateType`：`basePrice` / `subPrice` 实测恒为 `3`。
 *
 * 未知码不臆造结论 —— 原值进 `updateOperateTypes`，让它在 RMS 侧可见，将来踩清了再扩大
 * 可比范围。
 *
 * ============================================================================
 * demo（取自 `批量改房价-基础改价.md` 的真实序列）
 * ============================================================================
 *
 * 用户勾选 3 个房型 → 初次试算（3 个都算）→ 开周末差异定价（只重算 787306）→ 改数值
 * （只重算 787306）→ 改第三个房型（只重算 818026）→ 提交。
 *
 * 提交体共 3 房型 × 2 周次档 = **6 格**，而累积的 calc 素材只覆盖其中 2 格：
 *
 * ```jsonc
 * "calcUpdateCheck": {
 *   "comparable": true,              // update 全是 operateType 6
 *   "updateOperateTypes": [6],
 *   "cells": [
 *     {
 *       "goodsId": "1135787306",
 *       "startDate": "2026-08-26", "endDate": "2026-08-29",
 *       "inWeek": [5, 6],
 *       "status": "matched",         // ✅ RMS 可用
 *       "updateValue": "65100",
 *       "calcValue": "65100"
 *     },
 *     {
 *       "goodsId": "1135787306",
 *       "startDate": "2026-08-26", "endDate": "2026-08-29",
 *       "inWeek": [1, 2, 3, 4, 7],
 *       "status": "missing-calc",    // ❌ 用户开周末差异后没重算这一档
 *       "updateValue": "65100",
 *       "calcValue": null
 *     },
 *     {
 *       "goodsId": "1135800654",
 *       "startDate": "2026-08-26", "endDate": "2026-08-29",
 *       "inWeek": [1, 2, 3, 4, 7],
 *       "status": "missing-calc",
 *       "updateValue": "67100",
 *       "calcValue": null
 *     },
 *     {
 *       "goodsId": "1135800654",
 *       "startDate": "2026-08-26", "endDate": "2026-08-29",
 *       "inWeek": [5, 6],
 *       "status": "missing-calc",
 *       "updateValue": "67200",
 *       "calcValue": null
 *     },
 *     {
 *       "goodsId": "1135818026",
 *       "startDate": "2026-08-26", "endDate": "2026-08-29",
 *       "inWeek": [1, 2, 3, 4, 7],
 *       "status": "matched",         // ✅
 *       "updateValue": "69000",
 *       "calcValue": "69000"
 *     },
 *     {
 *       "goodsId": "1135818026",
 *       "startDate": "2026-08-26", "endDate": "2026-08-29",
 *       "inWeek": [5, 6],
 *       "status": "missing-calc",
 *       "updateValue": "69200",
 *       "calcValue": null
 *     }
 *   ]
 * }
 * ```
 *
 * 漂移（`mismatched`）的样子，取自 `房价房量日历踩点.md`：
 *
 * ```jsonc
 * {
 *   "goodsId": "1135785332",
 *   "startDate": "2026-08-27", "endDate": "2026-08-27",
 *   "inWeek": [1, 2, 3, 4, 5, 6, 7],
 *   "status": "mismatched",          // ❌ calc 说改成 470.00，实际提交 471.00
 *   "updateValue": "47100",
 *   "calcValue": "47000"
 * }
 * ```
 *
 * `not-comparable` 的样子，取自 `改价踩点.md`（用户用的是「加价 1 元」）：
 *
 * ```jsonc
 * "calcUpdateCheck": {
 *   "comparable": false,
 *   "updateOperateTypes": [1],
 *   "cells": [
 *     {
 *       "goodsId": "847226645",
 *       "startDate": "2026-08-25", "endDate": "2026-08-26",
 *       "inWeek": [1, 2, 3, 4, 7],
 *       "status": "not-comparable",
 *       "updateValue": "100",        // ⚠️ 这是**增量** +1.00 元，不是绝对价
 *       "calcValue": "19066"
 *     }
 *   ]
 * }
 * ```
 *
 * ⚠️ `not-comparable` 时 `updateValue` 与 `calcValue` **量纲不同**（一个是增量、一个是
 * 绝对价），RMS **MUST NOT** 拿它们相减或比较。两个值都留着只为留痕。
 */

import type { JsonObject } from '../../../shared/types/json';
import { meituanCalcCellKey, type MeituanCalcCell } from './amount-change-payload';

/**
 * 一格对照的结论。四种取值互斥，判定依据见文件头。
 *
 * 只有 `matched` 可直接跟价，其余三种一律降级 —— 这是本模型存在的全部意义。
 */
export type CalcUpdateCellStatus =
  /** calc 有素材且与 update 一致。✅ 唯一可直接跟价的。 */
  | 'matched'
  /** calc 有素材但与 update 不符 —— 素材已过时（用户改完没再触发试算）。 */
  | 'mismatched'
  /** update 里有这一格，累积的 calc 素材里没有 —— 美团没为它发试算。 */
  | 'missing-calc'
  /** update 非绝对值表达（加价、不改动、未知码），无从比对。 */
  | 'not-comparable';

/**
 * 一格 = (房型 × 日期区间 × 周次档)。定位三件套与 `changeRaw.goodsDetails` 里的表达同源。
 *
 * ⚠️ 这**不是**上报体新增的字段本身 —— 它是 `MeituanCalcUpdateCheck.cells` 数组里每一项的
 * 类型。RMS 收到的是一整份 `calcUpdateCheck`，遍历它的 `cells` 才拿到一格一格。
 */
export type MeituanCalcUpdateCell = Readonly<{
  /** 售卖商品 ID = RMS 追价台账的 `ota_sale_room_type_id`。 */
  goodsId: string;
  /** 日期区间起，`YYYY-MM-DD`。 */
  startDate: string;
  /** 日期区间止，`YYYY-MM-DD`，闭区间。 */
  endDate: string;
  /** 周次档，1=周一 … 7=周日，**升序**。 */
  inWeek: readonly number[];
  /** 这一格的素材可不可信，见 `CalcUpdateCellStatus`。 */
  status: CalcUpdateCellStatus;
  /**
   * **update 侧**的 `operateNum`，×100 字符串原值，不换算。
   *
   * ⚠️ 仅当同份 `comparable` 为 true 时它才是**绝对价**；否则可能是增量或空串，
   * 见文件头 `operateType` 表。
   */
  updateValue: string | null;
  /** **calc 侧**的改后价，×100 字符串原值。该格没有 calc 素材时为 null。 */
  calcValue: string | null;
}>;

/**
 * 一次改价提交的完整对照结果 —— 挂在 `changeRaw.calcUpdateCheck` 上。
 *
 * ⚠️ **desktop 计算产物，不是美团原始字段**，与 `changeRaw` 其余内容性质相反，见文件头。
 */
export type MeituanCalcUpdateCheck = Readonly<{
  /**
   * update 是否以**绝对值**表达价格（全部 `operateType === 6`）。
   *
   * 为 false 时**所有** cell 都是 `not-comparable` —— 不做「部分可比」的混合口径。
   */
  comparable: boolean;
  /**
   * update 里实际出现过的 `operateType`，去重升序。
   *
   * 未知码靠它暴露：不臆造比对结论，但把原值带出去，将来踩清了能直接扩大可比范围。
   */
  updateOperateTypes: readonly number[];
  /** 逐格对照。顺序跟随 update 提交体的出现顺序。 */
  cells: readonly MeituanCalcUpdateCell[];
}>;

/* ============================================================================
 * 构造：把累积的 calc 素材与 update 提交体逐格对照
 * ============================================================================ */

/** 直接设价 —— `operateNum` 是绝对值，**唯一可比对的 operateType**，见文件头。 */
const OPERATE_TYPE_ABSOLUTE = 6;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toIdString(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string') return value.trim();
  return '';
}

/** update 提交体里展开出的一格。`operateNum` 原样，不换算。 */
type UpdateCell = Readonly<{
  goodsId: string;
  startDate: string;
  endDate: string;
  inWeek: readonly number[];
  operateType: number | null;
  operateNum: string | null;
}>;

/**
 * 展开 update 提交体。
 *
 * 提交体的字段名与 calc 响应**不同**（`calcPriceUnifiedDateModel` / `calcPriceWeekModels`
 * / `calcPriceInfo.salePrice.operateNum`），但 `(日期 × 周次)` 的组合语义一致 ——
 * 归一只发生在这里，`changeRaw.goodsDetails` 仍是 calc 响应的原始形状（design.md 决策 6）。
 */
function extractUpdateCells(requestBody: JsonObject): readonly UpdateCell[] {
  const goodsList = requestBody.goodsList;
  if (!Array.isArray(goodsList)) return [];

  const cells: UpdateCell[] = [];
  for (const goods of goodsList) {
    if (!isJsonObject(goods)) continue;
    const baseInfo = goods.goodsBaseInfo;
    const goodsId = isJsonObject(baseInfo) ? toIdString(baseInfo.goodsId) : '';
    if (!goodsId) continue;

    const model = goods.calcPriceUnifiedDateModel;
    if (!isJsonObject(model)) continue;
    const dates = model.dates;
    const weekModels = model.calcPriceWeekModels;
    if (!Array.isArray(dates) || !Array.isArray(weekModels)) continue;

    for (const date of dates) {
      if (!isJsonObject(date)) continue;
      const startDate = toIdString(date.startDate);
      const endDate = toIdString(date.endDate);
      if (!startDate || !endDate) continue;

      for (const weekModel of weekModels) {
        if (!isJsonObject(weekModel)) continue;
        const inWeek = Array.isArray(weekModel.inWeek)
          ? weekModel.inWeek.filter((n): n is number => typeof n === 'number').sort((a, b) => a - b)
          : [];
        if (inWeek.length === 0) continue;

        // 只看 salePrice —— basePrice / subPrice 实测恒为 operateType 3（不改动）。
        const calcPriceInfo = weekModel.calcPriceInfo;
        const salePrice = isJsonObject(calcPriceInfo) ? calcPriceInfo.salePrice : null;
        const operateType =
          isJsonObject(salePrice) && typeof salePrice.operateType === 'number'
            ? salePrice.operateType
            : null;
        const operateNum =
          isJsonObject(salePrice) && typeof salePrice.operateNum === 'string'
            ? salePrice.operateNum
            : null;

        cells.push({ goodsId, startDate, endDate, inWeek, operateType, operateNum });
      }
    }
  }
  return cells;
}

/**
 * 对照累积的 calc 素材与 update 提交体，产出 `changeRaw.calcUpdateCheck`。
 *
 * 遍历的是 **update 侧**：用户实际提交了什么才是基准，累积素材里多出来的（例如被
 * `rebuildGoodsDetails` 过滤掉的过期日期区间）不进 cells。
 *
 * `comparable` 是整份一个结论：只要出现任何非 `6` 的 `operateType`，整份不可比 ——
 * 不做「部分可比」的混合口径，见文件头。
 */
export function buildMeituanCalcUpdateCheck(
  requestBody: JsonObject,
  calcCells: Readonly<Record<string, MeituanCalcCell>>,
): MeituanCalcUpdateCheck {
  const updateCells = extractUpdateCells(requestBody);

  const operateTypes = [
    ...new Set(
      updateCells
        .map((cell) => cell.operateType)
        .filter((type): type is number => typeof type === 'number'),
    ),
  ].sort((a, b) => a - b);

  const comparable =
    updateCells.length > 0 && operateTypes.length > 0
      ? operateTypes.every((type) => type === OPERATE_TYPE_ABSOLUTE)
      : false;

  const cells = updateCells.map((updateCell): MeituanCalcUpdateCell => {
    const key = meituanCalcCellKey(
      updateCell.goodsId,
      updateCell.startDate,
      updateCell.endDate,
      updateCell.inWeek,
    );
    const calcCell = calcCells[key];
    const calcValue = calcCell?.salePrice ?? null;

    // 不可比时不看值 —— updateValue 与 calcValue 量纲不同，比较无意义（见文件头）。
    const status: CalcUpdateCellStatus = !comparable
      ? 'not-comparable'
      : calcCell === undefined
        ? 'missing-calc'
        : calcValue === updateCell.operateNum
          ? 'matched'
          : 'mismatched';

    return {
      goodsId: updateCell.goodsId,
      startDate: updateCell.startDate,
      endDate: updateCell.endDate,
      inWeek: updateCell.inWeek,
      status,
      updateValue: updateCell.operateNum,
      calcValue,
    };
  });

  return { comparable, updateOperateTypes: operateTypes, cells };
}
