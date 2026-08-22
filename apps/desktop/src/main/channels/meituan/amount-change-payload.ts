/**
 * 美团价量态改动的 `changeRaw` 模型 —— **RMS 侧对接美团时读这一份**。
 *
 * 数据来源：2026-08-11/12 真机实测（门店 762662011，账号 274615733），非踩点推断。
 * 标「未实测」的地方是明确的空白，不要当成已确认的事实。
 * 更长的背景与踩点原文见 `openspec/changes/ota-amount-change-watch/meituan-payload-spec.md`。
 *
 * ============================================================================
 * ⚠️ 一句话摘要：美团的 changeRaw 是**试算结果**，不是保存请求
 * ============================================================================
 *
 * 另两个渠道的保存请求体里价格就是绝对值，原样转发即可。美团不是 —— 它的保存请求体只说
 * 「卖价 +1 元」，**不说原来多少钱**（`goodsBaseInfo` 的 26 个字段里也没有当前价）。
 *
 * ```
 * ① 用户填写   → calcPriceV2    响应含「改前 189.66 → 改后 190.66」  ← changeRaw 来自它
 * ② 第一次发起 → updatePriceV2  createFlag: false  预检，服务端要求弹窗确认
 * ③ 用户点确认 → updatePriceV2  createFlag: true   ← 只当触发器，内容一概不上报
 * ```
 *
 * ⚠️ ① **会发很多次，每次只重算用户当次触碰的那一部分** —— 所以 `changeRaw.goodsDetails`
 * 是把多次试算**按格累积**后重建出来的，不是某一次试算的原样照搬（见下方「累积」一节）。
 * 形状与单次试算响应一致，RMS 现有解析逻辑不受影响。
 *
 * ⚠️ 累积再完整也不保证与用户实际提交的一致（美团可能没为某些档发过试算，用户也可能改完
 * 不再触发试算）。desktop **不对账、不判断素材可不可信** —— 那需要卖价+底价+佣金率三元组，
 * 是 RMS 的职责 —— 累积到什么就发什么，不做任何过滤。
 *
 * 保存请求体为什么一个字节都不发：它只有相对操作，而 **RMS 侧没有美团的数据** —— 既没有
 * 基准价可以算出结果，也无从校验。「+1 元」到了那边是死信息。真出现「试算与实际不符」，
 * 用户在页面上会看见并再改一次，那次自然产生新的试算。
 *
 * 因此上报体的 `endpointId` 恒为 **`calcPriceV2`**，`endpointUrl` 也指向试算那次。
 *
 * ============================================================================
 * changeRaw 的结构
 * ============================================================================
 *
 * ```
 * changeRaw                          = 试算响应的 data，裁剪后
 * ├── goodsDetails[]                   每个元素 = 一个房型
 * │   ├── goodsBaseInfo { goodsId }    ← 房型主键，数字型（RMS 的 ota_sale_room_type_id）
 * │   ├── unifiedDatePriceInfos        形状①：统一日期，见下
 * │   ├── priceInfos                   形状②：分段日期，见下（与①二选一，另一个为 null）
 * │   ├── priceRecordWay               8 = 改的是卖价 / 9 = 改的是低价
 * │   ├── weekDiff                     用户有没有开「周末差异定价」
 * │   ├── pricePrompt                  语义未知，实测恒空
 * │   └── ratioConfig                  比例联动配置，实测恒 null
 * └── globalPricePrompt                语义未知，实测恒空
 * ```
 *
 * ⚠️ **这张图里全是美团发来的原始内容**（忠实透传、只裁不改）—— desktop 不往 `changeRaw`
 * 里加任何自己算出来的字段。
 *
 * ## 两种日期形状，RMS 必须都认
 *
 * ```
 * ① unifiedDatePriceInfos: {         ② priceInfos: [
 *      dates: [                           { startDate: "2026-08-25",
 *        { startDate: "2026-08-25",         endDate:   "2026-08-26",
 *          endDate:   "2026-08-26" }        weekPriceInfos: [ … ] },
 *      ],                                 { startDate: "2026-08-27", … }
 *      weekPriceInfos: [ … ]            ]
 *    }
 *    日期集中在一处                     日期跟着每一段走，可以有多段
 * ```
 *
 * ②比①**多一层数组**，①相当于②只有一段的特例。`weekPriceInfos` 及其以下结构两者完全一致
 * —— 差别仅在日期挂哪一层。建议 RMS 侧先归一成 `(日期区间, 周次档)` 再展开：
 *
 * ```ts
 * function segmentsOf(goods) {
 *   // 形状②：日期跟着每一段走
 *   if (Array.isArray(goods.priceInfos)) {
 *     return goods.priceInfos.map((m) => ({
 *       startDate: m.startDate, endDate: m.endDate, weekPriceInfos: m.weekPriceInfos,
 *     }));
 *   }
 *   // 形状①：所有日期区间**共享**同一批周次档
 *   const u = goods.unifiedDatePriceInfos;
 *   return u.dates.map((d) => ({
 *     startDate: d.startDate, endDate: d.endDate, weekPriceInfos: u.weekPriceInfos,
 *   }));
 * }
 * // 展开成 (房型 × 日期区间 × 周次) 后，跳过 priceInfo 为 null 的档：
 * //   改后价 = Number(w.priceInfo.salePrice) / 100
 * //   改前价 = Number(w.originalPriceInfo.salePrice) / 100
 * ```
 *
 * ⚠️ 形状①里 `dates` 是数组而 `weekPriceInfos` 只有一份 —— 多个日期区间**共享**同一批周次档。
 * 实测只见过 `dates` 长度为 1，长度 >1 时是否仍是共享语义**未实测**。
 *
 * ## weekPriceInfos[] —— 价格就在这里
 *
 * ```
 * weekPriceInfos[j]
 * ├── inWeek              [1,2,3,4,7]  数字，1=周一 … 7=周日（同抖音）
 * ├── priceInfo           ← **改后**  { salePrice, basePrice, subPrice, subRatio, baseAddRatio }
 * ├── originalPriceInfo   ← **改前**  同上
 * ├── priceFactorInfos            实测恒 null
 * └── originalPriceFactorInfos    实测恒 null
 * ```
 *
 * **金额一律是 ×100 的字符串**：`"19066"` = 190.66 元。取值 `Number(salePrice) / 100`。
 *
 * 实测样例（卖价 +1 元）：
 * ```
 * originalPriceInfo.salePrice  "18966"   改前 189.66 元
 * priceInfo.salePrice          "19066"   改后 190.66 元   ← RMS 跟价要的就是它
 * ```
 *
 * ⚠️ **`priceInfo` 可能为 null**：某个周次档在日期区间内没有实际日期落入时，美团会给
 * `{ inWeek: [5,6], priceInfo: null, originalPriceInfo: null }`。跳过即可，不是异常。
 *
 * ============================================================================
 * 裁剪：剔了什么、为什么
 * ============================================================================
 *
 * | 剔除项 | 理由 |
 * |---|---|
 * | 信封层 `code`/`error`/`traceId`/`success` | 我们是旁听者，不会拿 `traceId` 回头找美团对账；成功与否已由 `isSuccessful` 判过，判失败的根本不会走到上报 |
 * | 试算**请求体**整份 | 它回显的当前价量纲是**元**（`"189.66"`），与响应的**分**（`"18966"`）不一致，且是冗余 —— 响应里那份既统一又多了改后价 |
 * | `goodsDetails[].goodsBaseInfo` 的其余 25 个字段 | 全是房型静态属性（房型名、早餐数、审核状态…），与改了什么价无关 |
 * | `goodsDetails[].realPriceInfos` | **有害字段**，见下 |
 *
 * ⚠️ **`realPriceInfos` 为什么必须剔掉**：它的 `inWeek` 是服务端按「区间内实际存在的日期 +
 * 原价是否相同」**重新拆分**过的，与用户选的周次档对不上 —— 实测同一响应里请求档是
 * `[1,2,3,4,7]`，它给的是 `[2,3]`（区间 08-25~08-26 只含周二周三）。留着会诱导 RMS 把价格
 * 安错档，不只是冗余。
 *
 * 其余一律保留。裁剪与「desktop 忠实透传、不解读语义」本就冲突：携程剔的是设备指纹类
 * **噪音**，这里剔的是**业务字段**，剔错了 RMS 侧再也看不到原始数据、**不可恢复**。所以
 * 语义未知的（`ratioConfig`、`pricePrompt`）一律留着 —— 万一将来用户开了比例联动，
 * `ratioConfig` 是唯一能看出来的地方。
 *
 * 实测收益（2026-08-12 真机，单房型）：2074 → 827 chars。
 *
 * ============================================================================
 * 未实测清单（写明空白，避免被当成已确认的事实）
 * ============================================================================
 *
 * - `subPrice` / `subRatio` / `baseAddRatio` 分别代表什么价（实测从未被单独改动）
 * - 形状①的 `dates` 长度 >1 时，周次档是否仍为共享语义
 * - `pricePrompt` / `ratioConfig.ratioType` / `globalPricePrompt` 的语义（实测恒空）
 * - 失败响应的形状 —— `10000` 是美团网关的成功码，业务失败时它与 `success` 几乎必然
 *   一起变，两个都要求为真的判定不会把失败当成功；残留风险只是「网关成功但业务拒绝」
 *   这种形状，目前纯属推测
 * - `updatePriceV2` 之外是否还有别的保存端点（房态房量尚未接入）
 */
import type { JsonObject } from '../../../shared/types/json';

/**
 * 美团的 `changeRaw`。
 *
 * 用 `JsonObject` 的宽松形状而不是逐字段的严格类型：desktop **忠实透传、不解读语义**，
 * 逐字段建模等于在这里复刻美团的定价语义，而美团随时可能加字段（加了就会被静默丢弃，
 * 比多带几个未知字段糟糕得多）。类型的作用是**说明结构**，校验只做到「能不能定位」为止。
 */
export type MeituanAmountChangeRaw = JsonObject &
  Readonly<{
    goodsDetails?: readonly JsonObject[];
    globalPricePrompt?: JsonObject | null;
  }>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 裁剪一条 `goodsDetails[]`：`goodsBaseInfo` 收成 `{goodsId}`、剔 `realPriceInfos`。见文件头。 */
function trimGoodsDetail(detail: JsonObject): JsonObject {
  const trimmed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (key === 'realPriceInfos') continue;
    if (key === 'goodsBaseInfo') {
      trimmed.goodsBaseInfo = isJsonObject(value) ? { goodsId: value.goodsId ?? null } : value;
      continue;
    }
    trimmed[key] = value;
  }
  return trimmed as JsonObject;
}

/**
 * 从 `calcPriceV2` 的响应原文构造 `changeRaw`：取信封里的 `data`，逐条裁剪 `goodsDetails`。
 *
 * @returns 响应形状不认识时返回 `null` —— 调用方据此**保留上一条试算**，
 *          宁可用旧的也不要存个空壳。
 */
export function toMeituanAmountChangeRaw(responseBody: string): MeituanAmountChangeRaw | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseBody);
  } catch {
    return null;
  }
  if (!isJsonObject(parsed)) return null;
  const data = parsed.data;
  if (!isJsonObject(data)) return null;

  const goodsDetails = data.goodsDetails;
  const trimmedDetails = Array.isArray(goodsDetails)
    ? goodsDetails.map((detail) => (isJsonObject(detail) ? trimGoodsDetail(detail) : detail))
    : goodsDetails;

  return { ...data, goodsDetails: trimmedDetails } as MeituanAmountChangeRaw;
}


/* ============================================================================
 * 累积：把多次 calc 攒成一份完整素材
 * ============================================================================
 *
 * 美团的 `calcPriceV2` **只重算用户当次触碰的那一部分**，不是每次都带全量（2026-08-22
 * 踩点推翻了早先「每条 calc 都带页面上全量房型」的判断）。所以不能整条覆盖，必须按格累积：
 *
 * ```
 * calc①  改了 A 房型   →  {A}
 * calc②  改了 B 房型   →  {A, B}      ← 覆盖的话 A 就丢了
 * calc③  又改了 A      →  {A', B}     ← 同格覆盖，取新值
 * ```
 *
 * 一格（cell）= (房型 × 日期区间 × 周次档)。
 */

/** 累积的一格。`detail` 留着重建 `goodsDetails[]` 用，见 `rebuildGoodsDetails`。 */
export type MeituanCalcCell = Readonly<{
  goodsId: string;
  startDate: string;
  endDate: string;
  /** 升序，与累积键一致。 */
  inWeek: readonly number[];
  /**
   * 改前价，×100 字符串。
   *
   * ⚠️ **同格再次出现时保留首次的这一份**。
   *
   * 实测美团给的 `originalPriceInfo` 始终是**用户本次操作前的真实起点**，不随重算变化
   * （`批量改房价-基础改价` 里 `787306` 被改三次，`original` 恒为 `65159`：
   * `calc#0 original=65159 new=65000` / `calc#1 original=65159 new=65100` /
   * `calc#2 original=65159 new=65100`）。既然值恒定，「保留首次」与「取最新」等价 ——
   * 保留首次是更保守的口径：万一将来美团改成回填中间态，这里仍然给出真实起点。
   *
   * ⚠️ 早先这段注释编造过一串「65159 →(calc①) 65100 →(calc②) 65000」的所谓真实序列，
   * 2026-08-22 复核踩点后确认**不存在**，已订正。别据此推断美团会回填改后价。
   */
  originalSalePrice: string | null;
  /** 改后价，×100 字符串。同格取最新。 */
  salePrice: string | null;
  /**
   * 该格在 calc 响应里的**整条 `weekPriceInfos[]` 元素**，原样留着。
   *
   * ⚠️ 不只存 `salePrice`：同一条里还有 `basePrice` / `subPrice` / `subRatio` /
   * `baseAddRatio` / `priceFactorInfos`，其中几个语义未确认。裁剪的判据是「与本次改动
   * 无关」而不是「我们看不看得懂」（见文件头），所以整条留着，重建时原样放回去。
   */
  weekPriceInfo: JsonObject;
  /** 该格所属房型在这次 calc 响应里的完整明细（已裁剪），重建上报体用。 */
  detail: JsonObject;
}>;

/**
 * 累积上限。正常量级是「房型 × 日期段 × 周次档」，实测个位数到几十；这个上限纯属兜底，
 * 防止长时间停留在页面反复试算导致无限增长。超限丢最早的（`Record` 的插入序）。
 */
export const MEITUAN_CALC_CELL_LIMIT = 500;

/** 累积键 —— 四个维度缺一不可，理由见 design.md 决策 1。 */
export function meituanCalcCellKey(
  goodsId: string,
  startDate: string,
  endDate: string,
  inWeek: readonly number[],
): string {
  return `${goodsId}|${startDate}|${endDate}|${[...inWeek].sort((a, b) => a - b).join(',')}`;
}

function toIdString(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string') return value.trim();
  return '';
}

function toPriceString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function toWeekNumbers(value: unknown): readonly number[] | null {
  if (!Array.isArray(value)) return null;
  const week: number[] = [];
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isFinite(item)) return null;
    week.push(item);
  }
  return week.sort((a, b) => a - b);
}

/**
 * 把一条 `goodsDetails[]` 的两种日期形状归一成 `(日期区间, 周次档列表)`。
 *
 * ```
 * 形状①  unifiedDatePriceInfos { dates[], weekPriceInfos[] }   dates 共享同一批周次档
 * 形状②  priceInfos[] { startDate, endDate, weekPriceInfos[] } 日期跟着每段走
 * ```
 *
 * 与文件头「RMS 侧建议的 segmentsOf」同一套逻辑 —— 这里是 desktop 自己累积时用。
 */
function segmentsOf(
  detail: JsonObject,
): readonly Readonly<{ startDate: string; endDate: string; weekPriceInfos: readonly unknown[] }>[] {
  const segments: { startDate: string; endDate: string; weekPriceInfos: readonly unknown[] }[] = [];

  // 形状②优先：两者互斥，未使用的那个是 null。
  if (Array.isArray(detail.priceInfos)) {
    for (const segment of detail.priceInfos) {
      if (!isJsonObject(segment)) continue;
      const weekPriceInfos = segment.weekPriceInfos;
      if (!Array.isArray(weekPriceInfos)) continue;
      segments.push({
        startDate: toIdString(segment.startDate),
        endDate: toIdString(segment.endDate),
        weekPriceInfos,
      });
    }
    return segments;
  }

  const unified = detail.unifiedDatePriceInfos;
  if (!isJsonObject(unified)) return segments;
  const weekPriceInfos = unified.weekPriceInfos;
  if (!Array.isArray(weekPriceInfos) || !Array.isArray(unified.dates)) return segments;
  for (const date of unified.dates) {
    if (!isJsonObject(date)) continue;
    segments.push({
      startDate: toIdString(date.startDate),
      endDate: toIdString(date.endDate),
      // ⚠️ 多个日期区间**共享**同一批周次档，见文件头形状①的说明。
      weekPriceInfos,
    });
  }
  return segments;
}

/**
 * 从一份 calc 素材里展开出全部格子。
 *
 * ⚠️ 跳过 `priceInfo` 为 null 的档 —— 某周次档在区间内没有实际日期落入时美团会给 null，
 * 这是正常情况不是异常（见文件头）。跳过它们，避免把空档当成一次改动记进累积。
 */
export function extractMeituanCalcCells(
  raw: MeituanAmountChangeRaw,
): readonly MeituanCalcCell[] {
  const details = raw.goodsDetails;
  if (!Array.isArray(details)) return [];

  const cells: MeituanCalcCell[] = [];
  for (const detail of details) {
    if (!isJsonObject(detail)) continue;
    const baseInfo = detail.goodsBaseInfo;
    const goodsId = isJsonObject(baseInfo) ? toIdString(baseInfo.goodsId) : '';
    if (!goodsId) continue;

    for (const segment of segmentsOf(detail)) {
      if (!segment.startDate || !segment.endDate) continue;
      for (const weekPriceInfo of segment.weekPriceInfos) {
        if (!isJsonObject(weekPriceInfo)) continue;
        const inWeek = toWeekNumbers(weekPriceInfo.inWeek);
        if (inWeek === null || inWeek.length === 0) continue;

        const priceInfo = weekPriceInfo.priceInfo;
        // 空档：该周次在区间内没有实际日期，不是一次改动。
        if (!isJsonObject(priceInfo)) continue;
        const originalPriceInfo = weekPriceInfo.originalPriceInfo;

        cells.push({
          goodsId,
          startDate: segment.startDate,
          endDate: segment.endDate,
          inWeek,
          originalSalePrice: isJsonObject(originalPriceInfo)
            ? toPriceString(originalPriceInfo.salePrice)
            : null,
          salePrice: toPriceString(priceInfo.salePrice),
          weekPriceInfo,
          detail,
        });
      }
    }
  }
  return cells;
}

/**
 * 同格再次出现时，把**首次那条**的 `originalPriceInfo` 整块搬回来。
 *
 * 只回填 `salePrice` 是不够的：`originalPriceInfo` 里的 `basePrice` / `subPrice` 等同样
 * 是「改动前」的快照，第二次 calc 给的那份已经是第一次改动后的结果。整块搬才自洽。
 *
 * 首次那条没有 `originalPriceInfo` 时退回逐字段设 `salePrice`，保证至少改前价是对的。
 */
function withOriginalSalePrice(
  weekPriceInfo: JsonObject,
  originalSalePrice: string | null,
  previousWeekPriceInfo: JsonObject,
): JsonObject {
  const previousOriginal = previousWeekPriceInfo.originalPriceInfo;
  if (isJsonObject(previousOriginal)) {
    return { ...weekPriceInfo, originalPriceInfo: previousOriginal };
  }
  const current = weekPriceInfo.originalPriceInfo;
  return {
    ...weekPriceInfo,
    originalPriceInfo: isJsonObject(current)
      ? { ...current, salePrice: originalSalePrice }
      : { salePrice: originalSalePrice },
  };
}

/**
 * 把新一批格子并入已累积的。
 *
 * - 同键：**改后价取新的、改前价保留首次**（见 `MeituanCalcCell.originalSalePrice`）
 * - 新键：追加
 * - 超过 `MEITUAN_CALC_CELL_LIMIT`：丢最早的（插入序），返回被丢弃的条数供调用方记日志
 */
export function mergeMeituanCalcCells(
  accumulated: Readonly<Record<string, MeituanCalcCell>>,
  incoming: readonly MeituanCalcCell[],
): Readonly<{ cells: Record<string, MeituanCalcCell>; dropped: number }> {
  const merged: Record<string, MeituanCalcCell> = { ...accumulated };

  for (const cell of incoming) {
    const key = meituanCalcCellKey(cell.goodsId, cell.startDate, cell.endDate, cell.inWeek);
    const previous = merged[key];
    merged[key] = previous
      ? {
          ...cell,
          // 改前价保留首次那份；首次若为 null 才用新的补上。
          originalSalePrice: previous.originalSalePrice ?? cell.originalSalePrice,
          // 整条也要跟着回填 —— 否则重建出来的 originalPriceInfo 仍是中间态。
          weekPriceInfo: withOriginalSalePrice(
            cell.weekPriceInfo,
            previous.originalSalePrice ?? cell.originalSalePrice,
            previous.weekPriceInfo,
          ),
        }
      : cell;
  }

  let dropped = 0;
  const keys = Object.keys(merged);
  if (keys.length > MEITUAN_CALC_CELL_LIMIT) {
    dropped = keys.length - MEITUAN_CALC_CELL_LIMIT;
    for (const key of keys.slice(0, dropped)) delete merged[key];
  }
  return { cells: merged, dropped };
}

/* ============================================================================
 * 改价模式 —— 两种模式的渠道行为不同，累积方式也必须不同
 * ============================================================================
 *
 * 美团的批量设价页有两种改价模式，**渠道行为完全不同**，不能塞进同一条处理路径
 * （设计见 `openspec/changes/extend-meituan-price-status-coverage/design-mode-split.md`）：
 *
 * ```
 * 模式 A「基础 / 日历」                 模式 B「高级（日期分开改价）」
 * ├ 请求体 calcPriceUnifiedDateModel     ├ 请求体 calcPriceModels[]
 * ├ calc 每次带**当前全量日期段**         ├ calc 每次**只带当次触碰的一段**
 * ├ 无 unified 端点                      ├ 有 unified（改动范围的快照）
 * └ 响应 unifiedDatePriceInfos           └ 响应 priceInfos[]
 * ```
 *
 * ⚠️ **判据取请求体字段，不取端点路径** —— `separate/calcPriceV2` 两个模式共用，端点区
 * 分不了。这是本次改动反复踩的坑：先按端点分支，结果两种模式的素材混进同一条累积。
 *
 * 五份踩点（`批量改房价-基础改价`/`基础模式02`/`房价房量日历踩点`/`高级改价`/
 * `高级改价-时间段改变`）实测两个字段**零重叠**，从不同时出现 —— 每条请求自己就说明了
 * 自己属于哪个模式。
 *
 * 累积策略随模式分流：
 *
 * ```
 *                 模式 A（基础/日历）           模式 B（高级）
 * 累积粒度    按 goodsId 整条覆盖        按 (goodsId,日期段,周次) 累积
 * 删日期段         覆盖自动解决                unified 清空
 * 删房型      update.goodsList 裁剪           unified 清空
 * ```
 */

/** 改价模式。判据是 calc **请求体**里的字段，见上方说明。 */
export type MeituanPriceMode = 'unifiedDate' | 'separateDate';

/**
 * 从 calc 请求体判定改价模式。
 *
 * 两个字段挂在 `goodsList[]` 的每个元素上，取**第一条认得出的**即可 —— 同一次请求里
 * 所有房型必然同模式（页面上模式是全局开关，不是逐房型的）。
 *
 * @returns 两个字段都没有时返回 `null` —— 形状不认识，调用方按「不改变已有模式」处理，
 *          不要猜。
 */
export function detectMeituanPriceMode(requestBody: JsonObject): MeituanPriceMode | null {
  const list = requestBody.goodsList;
  if (!Array.isArray(list)) return null;
  for (const item of list) {
    if (!isJsonObject(item)) continue;
    if (isJsonObject(item.calcPriceUnifiedDateModel)) return 'unifiedDate';
    if (Array.isArray(item.calcPriceModels)) return 'separateDate';
  }
  return null;
}

/**
 * 模式 A 的合并：**按 `goodsId` 整条覆盖**，不在日期维度上累积。
 *
 * 模式 A 的 calc 每次都带该房型**当前完整的日期列表**，不是增量（`基础模式02` 实证：
 * `calc#0` 请求 `dates=[09-08~09]`，`calc#1` 请求 `dates=[09-08~09, 09-11~12]` —— 全量）。
 * 增删日期段都会触发 calc，所以最后一次 calc 必然携带用户当前选定的全部日期段。
 *
 * 既然每次全量，就不该累积日期段 —— 累积会让**用户删掉的日期段永久残留**（旧日期段是
 * 独立的键，新 calc 不会覆盖到它）。按 `goodsId` 整条覆盖则自动解决：新 calc 带的就是
 * 删完之后的列表。
 *
 * ⚠️ 仍然**跨房型累积** —— 美团只为当次触碰的房型发 calc（`基础改价` 实测一次改 3 个房型，
 * 最后一条 calc 里只有 1 个）。覆盖的粒度是「一个 goodsId 的整条明细」，不是整个 context。
 *
 * ⚠️ 改前价仍**保留首次**：整条覆盖只丢掉该房型的旧格子，同格的 `originalPriceInfo` 要
 * 从被覆盖的那一份里搬回来，否则连续改同一格时会丢失用户操作前的真实起点。
 */
export function mergeMeituanCalcCellsByGoods(
  accumulated: Readonly<Record<string, MeituanCalcCell>>,
  incoming: readonly MeituanCalcCell[],
): Readonly<Record<string, MeituanCalcCell>> {
  // 本次 calc 覆盖到的房型 —— 它们的旧格子整条作废。
  const touched = new Set(incoming.map((cell) => cell.goodsId));

  const kept: Record<string, MeituanCalcCell> = {};
  // 被覆盖房型的旧格子先留在一边，供同格的改前价回填用（下面 merge 完就丢）。
  const superseded: Record<string, MeituanCalcCell> = {};
  for (const [key, cell] of Object.entries(accumulated)) {
    if (touched.has(cell.goodsId)) superseded[key] = cell;
    else kept[key] = cell;
  }

  // 复用逐格合并拿到「改前价保留首次」的回填，再只挑本次 calc 真正带回来的键 ——
  // `superseded` 里没被 incoming 命中的那些，正是用户删掉的日期段，就此丢弃。
  const { cells: refilled } = mergeMeituanCalcCells(superseded, incoming);
  for (const cell of incoming) {
    const key = meituanCalcCellKey(cell.goodsId, cell.startDate, cell.endDate, cell.inWeek);
    kept[key] = refilled[key] ?? cell;
  }
  return kept;
}

/**
 * 丢弃不在提交清单里的房型 —— **模式 A 专用**。
 *
 * 模式 A **减少房型不触发任何请求**（`基础模式02` 实证：两条 `separate` 都只带 1 个房型，
 * 而 `update` 带 2 个 —— 反向操作同理，删房型时美团不重算），又没有 `unified` 快照，
 * 所以累积里被删掉的房型无人清理。唯一可靠的准绳是提交体：`updatePriceV2` 的 `goodsList`
 * 是**用户实际提交的全量房型清单**。
 *
 * ⚠️ 只能用 `createFlag === true` 那条（用户点确认的）；预检那条上游本就 `return null`，
 * 走不到这里。
 *
 * ## 这**不是**把已废弃的 `keep` 加回来
 *
 * | | 已废弃的 `keep` | 本函数 |
 * |---|---|---|
 * | 裁剪维度 | `(goodsId, 日期段)` | **只裁 `goodsId`** |
 * | 解决什么 | 日期段变更残留 | **房型移除残留** |
 * | 依赖 | 解读提交体的**日期结构**（两种模式形状不同） | 只读 `goodsBaseInfo.goodsId`（**两种模式路径相同**） |
 * | 失效方式 | 形状不认识 → 空集 → **整条清零** | 读不出 goodsId 时上游守卫已 `return null`，走不到这里 |
 *
 * `keep` 的致命缺陷源于「日期结构有两种形状，只认一种就返回空集」，而 `goodsId` 的取法
 * 两个模式完全一致，该缺陷不复存在。
 *
 * ⚠️ 模式 B **不用**这个函数 —— `unified` 已覆盖房型移除的场景，两条路各自闭环。
 */
export function dropRoomTypesNotSubmitted(
  cells: Readonly<Record<string, MeituanCalcCell>>,
  submittedGoodsIds: readonly string[],
): Readonly<Record<string, MeituanCalcCell>> {
  const submitted = new Set(submittedGoodsIds);
  const kept: Record<string, MeituanCalcCell> = {};
  for (const [key, cell] of Object.entries(cells)) {
    if (submitted.has(cell.goodsId)) kept[key] = cell;
  }
  return kept;
}

/**
 * 从累积的格子重建 `goodsDetails[]` —— **形状与单次 calc 响应一致**，RMS 现有解析逻辑
 * 继续有效（这是硬要求：累积是 desktop 内部的事，不该让 RMS 跟着改）。
 *
 * 同一房型的多个格子合并回一条明细：以该房型**最后一次** calc 的 `detail` 为骨架（房型静态
 * 属性、`priceRecordWay`、`weekDiff` 等都在里面），把日期与周次重写成累积到的全部格子，
 * 统一用**形状②**（`priceInfos[]`）输出 —— 它能表达多段日期，形状①不能。
 *
 * ## 废弃的格子是怎么被清掉的 —— **按模式两条路**
 *
 * 本函数**不做任何过滤**，进来什么就重建什么。清理发生在更早的累积阶段，且两种模式
 * 各走各的（见上方「改价模式」一节）：
 *
 * ```
 * 模式 A（基础/日历）  删日期段 → 按 goodsId 整条覆盖，新 calc 带的就是删完的列表
 *                      删房型   → 提交时 dropRoomTypesNotSubmitted() 按 goodsList 裁
 * 模式 B（高级）        增删范围 → 页面重发 unified/calcPriceV2，见到即清空累积
 * ```
 *
 * 见 `../meituan/amount-change-adapter.ts` 的 `RANGE_ENDPOINT_ID` 与 `parse`。
 */
export function rebuildGoodsDetails(
  cells: Readonly<Record<string, MeituanCalcCell>>,
): readonly JsonObject[] {
  // 按房型分组，保持首次出现的顺序。
  const byGoods = new Map<string, MeituanCalcCell[]>();
  for (const cell of Object.values(cells)) {
    const group = byGoods.get(cell.goodsId);
    if (group) group.push(cell);
    else byGoods.set(cell.goodsId, [cell]);
  }

  const details: JsonObject[] = [];
  for (const group of byGoods.values()) {
    // 骨架取最后一条 —— 它是该房型最新一次 calc 的明细。
    const skeleton = group[group.length - 1].detail;

    // 同房型内按日期区间分段，段内按周次档排列。
    const bySegment = new Map<string, MeituanCalcCell[]>();
    for (const cell of group) {
      const segmentKey = `${cell.startDate}|${cell.endDate}`;
      const segment = bySegment.get(segmentKey);
      if (segment) segment.push(cell);
      else bySegment.set(segmentKey, [cell]);
    }

    const priceInfos = [...bySegment.values()].map((segment) => ({
      startDate: segment[0].startDate,
      endDate: segment[0].endDate,
      // 原样放回整条 —— basePrice / subRatio / priceFactorInfos 等一并保留。
      weekPriceInfos: segment.map((cell) => cell.weekPriceInfo),
    }));

    details.push({
      ...skeleton,
      // 统一输出形状②：它能表达多段日期，形状①做不到。两者 RMS 都认（见文件头）。
      priceInfos,
      unifiedDatePriceInfos: null,
    } as JsonObject);
  }
  return details;
}
