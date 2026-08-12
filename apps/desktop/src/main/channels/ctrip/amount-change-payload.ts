/**
 * 携程价量态改动的 `changeRaw` 模型 —— **RMS 侧对接携程时读这一份**。
 *
 * 数据来源：踩点 `docs/踩点/携程/改价.md`（老模块）+ 2026-08-11 真机实测（新模块）。
 *
 * ============================================================================
 * ⚠️ 一句话摘要：携程有**两套并存**的改价模块，形状完全不同
 * ============================================================================
 *
 * 同一个账号走不同入口会产生不同形状，**必须按 `endpointId` 分支**，不能只认一种。
 * 二者字段名无一相同：
 *
 * | | 老模块 | 新模块 |
 * |---|---|---|
 * | `endpointId` | `batchsetroomprice` | `setRCRoomPrice` |
 * | 页面 | `/ebkovsroom/inventory/calendar` | `/rateplan/batchPriceSetting` |
 * | 来源 | 踩点那份 curl | **真机走菜单「批量设价」的默认路径** |
 * | 房型列表 | `roomPriceInfoList[]` | `roomPriceInfos[]` |
 * | 房型 ID | `roomTypeID`（数字） | `roomProductId`（字符串） |
 * | 门店 ID | ✅ `hotelID`，**可能多家** | ❌ **请求体里根本没有** |
 * | 日期 | `dateRangeInfo[]` 集中一处 | 每条 `roomPriceInfos[]` 自带 `startDate`/`endDate` |
 * | 周次 | `weekDayIndex: "1111001"` 位串 | `weekDays: ["MONDAY",…]` 英文枚举 |
 * | 联动房型 | `refRoomIDs`（**一并改了这些**） | `excludedRelationRoomProductIds`（**排除这些**）|
 *
 * ⚠️ 最后一行是**语义相反**的两个字段，别当成同一个东西 —— 把新模块的排除列表当成
 * 「改过的房型」会把明确排除掉的房型报给 RMS。
 *
 * ============================================================================
 * changeRaw 的结构
 * ============================================================================
 *
 * `changeRaw` = **保存请求体**，剔除三个框架噪音字段后原样透传，**不做任何语义转换**。
 * 与美团那份（发的是试算结果）不同 —— 携程的请求体里价格就是绝对值，直接可用。
 *
 * ## 老模块 batchsetroomprice
 *
 * ```
 * changeRaw
 * ├── roomPriceInfoList[]
 * │   ├── roomTypeID       1587157432   数字，直接改的房型
 * │   ├── hotelID          115348672    数字，⚠️ 一次可能多家，见下
 * │   ├── refRoomIDs       [ … ]        **联动房型，这些房型的价也一并被改了**
 * │   ├── salePrice / costPrice         数字，**绝对值**，元（不像美团要 ×100）
 * │   └── weekDayIndex     "1111001"    位串，周一→周日，1=改这天
 * └── dateRangeInfo[]      [{ startDate, endDate }]
 * ```
 *
 * ⚠️ **老模块一次可以改多家门店**：`roomPriceInfoList[].hotelID` 可能不止一个，而契约的
 * `otaHotelId` 是单值（取第一家）。**RMS 必须遍历 `changeRaw.roomPriceInfoList[].hotelID`
 * 全量处理，只认 `otaHotelId` 会漏掉同一次保存里的其他门店。**
 *
 * ⚠️ `refRoomIDs` 必须收：踩点响应的 `roomTypeList: [1587157432, 1582872853]` 证实携程确实
 * 一并改了联动房型的价。只认 `roomTypeID` 会漏掉那部分。
 *
 * ## 新模块 setRCRoomPrice
 *
 * ```
 * changeRaw
 * ├── roomPriceInfos[]
 * │   ├── roomProductId    "1587157522"  字符串
 * │   ├── startDate / endDate            每条自带日期
 * │   ├── salePrice / costPrice          数字，**绝对值**，元
 * │   ├── commissionRate                 佣金率
 * │   ├── weekDays        ["MONDAY", …]  英文枚举
 * │   └── excludedRelationRoomProductIds  ⚠️ **排除**语义，见上
 * ├── dateRanges[]         [{ startDate, endDate }]
 * ├── diffWeekendPrice     true = 用户开了「周末差异定价」
 * └── weekendDays          ["SATURDAY"]  哪几天算周末
 * ```
 *
 * ⚠️ **同一个房型会在 `roomPriceInfos[]` 里出现多次**（2026-08-11 真机验证发现）。
 * 用户开「周末差异定价」时，携程把一个房型按周次拆成多条，各带不同价格：
 *
 * ```
 * roomProductId 1587157522  weekDays:[MON,TUE,WED,THU,FRI,SUN]  salePrice 720
 * roomProductId 1587157522  weekDays:[SATURDAY]                 salePrice 721  ← 同一房型
 * ```
 *
 * **RMS 展开时不能假设房型唯一，必须按 (房型 × 周次) 组合展开**，按房型去重会丢价格档。
 *
 * ## 门店怎么定位
 *
 * ```
 * batchsetroomprice   otaHotelId ✅ 有（多店时取第一家，全量在 changeRaw 里）
 * setRCRoomPrice      otaHotelId ❌ 空串 —— 用 roomPriceInfos[].roomProductId 反查门店
 * ```
 *
 * `otaHotelId` 为空是**正常情况，不是错误** —— desktop 只当探针，不查本地绑定、不操作页面
 * 去凑这个值。反查由 RMS 做，它的追价台账本来就把房型 ID 与门店 ID 成对存着。
 *
 * ============================================================================
 * 裁剪：只剔三个框架噪音字段
 * ============================================================================
 *
 * 与「这次改了什么价」毫无关系，纯粹是携程前端框架塞进去的。剔掉的理由不只是省体积：
 *
 * | 字段 | 是什么 | 为什么必须剔 |
 * |---|---|---|
 * | `reqHead` | 浏览器/设备/UBT 埋点信息 | 含屏幕分辨率、IP、UA 等**设备指纹**，没必要出本机 |
 * | `cipher` | 每个房型的 `tripsign` 签名串 | **凭证性质**，泄漏有风险，且对 RMS 无用 |
 * | `head` | SOA 框架头（cid/ctok/sid/auth） | 含 `auth` 字段 |
 *
 * **只做剔除，不做任何语义转换** —— 保留原始字段名与结构，RMS 复盘时看到的就是渠道原文。
 * 与美团相反：那边剔的是**业务字段**（不得不剔，因为量纲/分档会误导），这里剔的纯是噪音。
 *
 * ============================================================================
 * 已知的坑
 * ============================================================================
 *
 * - **新模块是异步任务**：响应里的 `taskId` 说明携程只是**受理**了改价，真正写库在后台跑。
 *   `resStatus.rcode === 200` 代表受理成功，**不代表价格已生效**。若 RMS 对时效敏感，
 *   需要考虑这层延迟。
 * - **响应体不上报**：渠道认没认已由适配器的 `isSuccessful` 判过（老模块看外层 `code` +
 *   内层每条 `resultCode`，新模块看 `resStatus.rcode` + `ResponseStatus.Ack`），判失败的
 *   根本不会走到上报这一步。
 */
import type { JsonObject } from '../../../shared/types/json';

/**
 * 携程的 `changeRaw` —— 两套模块的联合，按 `endpointId` 分辨是哪一种。
 *
 * 用 `JsonObject` 的宽松形状而不是逐字段的严格类型：desktop **忠实透传、不解读语义**，
 * 逐字段建模等于在这里复刻携程的定价语义，而携程随时可能加字段（加了就会被静默丢弃）。
 * 类型的作用是**说明结构**，校验只做到「能不能定位」为止。
 */
export type CtripAmountChangeRaw = JsonObject &
  Readonly<{
    /** 老模块 `batchsetroomprice`。 */
    roomPriceInfoList?: readonly JsonObject[];
    dateRangeInfo?: readonly JsonObject[];
    /** 新模块 `setRCRoomPrice`。 */
    roomPriceInfos?: readonly JsonObject[];
    dateRanges?: readonly JsonObject[];
  }>;

/** 见文件头「裁剪」。三个都在顶层，浅层剔除即可。 */
const NOISE_KEYS: readonly string[] = ['reqHead', 'cipher', 'head'];

/** 从保存请求体构造 `changeRaw`：剔掉框架噪音，其余原样。 */
export function toCtripAmountChangeRaw(requestBody: JsonObject): CtripAmountChangeRaw {
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(requestBody)) {
    if (NOISE_KEYS.includes(key)) continue;
    kept[key] = value;
  }
  return kept as CtripAmountChangeRaw;
}
