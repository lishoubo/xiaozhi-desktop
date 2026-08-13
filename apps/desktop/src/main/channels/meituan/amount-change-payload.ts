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
 * ① 用户填写   → calcPriceV2    响应含「改前 189.66 → 改后 190.66」  ← changeRaw 就是它
 * ② 第一次发起 → updatePriceV2  createFlag: false  预检，服务端要求弹窗确认
 * ③ 用户点确认 → updatePriceV2  createFlag: true   ← 只当触发器，内容一概不上报
 * ```
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

