/**
 * 携程**房态**改动的 `changeRaw` 模型 —— **RMS 侧对接携程房态时读这一份**。
 *
 * 数据来源：踩点 `docs/踩点/携程/房量01.md`（请求与响应样本都在里面）。
 *
 * 与改价分开成两份文件，是因为二者**没有一个字段同名**（改价那份还要同时讲清新老两套模块，
 * 合起来会变成一份四种形状的大杂烩）。改价的规格见 `./amount-change-payload.ts`。
 *
 * ============================================================================
 * changeRaw 的结构
 * ============================================================================
 *
 * ```
 * changeRaw
 * ├── roomStatus              "G" | "N"    ⚠️ **开关房的唯一依据**，见下
 * ├── hotelRoomInfoDtoList[]
 * │   ├── hotelID             115348672    数字，门店 ⚠️ 一次可能多家
 * │   ├── roomTypeID          1587157431   数字，销售房型 ID
 * │   └── roomName            "&#24742;…"  ⚠️ HTML 实体编码的房型名，见下
 * ├── dateItemInfoDtoList[]
 * │   ├── startDate           "2026-08-31"
 * │   └── endDate             "2026-08-31"     （holidyInfo 已剔除，见下）
 * ├── weekDayIndex            "1111111"    位串，周一→周日，1=这天生效
 * ├── originalRoomProductIds  [1587157431] 数字数组，与 roomTypeID 同一批房型
 * ├── pageType                "F"          携程前端的页面标识，语义未知，原样留着
 * └── processType             3            同上
 * ```
 *
 * ## ⚠️ `roomStatus`：`G` 开房、`N` 关房
 *
 * 开房与关房走的是**同一个端点、同一个形状**，整个请求体里只有这一个字段不同
 * （踩点两份 curl 逐字节对比只差这一处）。所以：
 *
 * - desktop **不拆成两个 `endpointId`** —— 那等于让 desktop 解读渠道语义，与「忠实透传、
 *   不解读」的定位冲突。
 * - **RMS 必须读这个字段**才知道用户是开房还是关房。只看 `changeType: 'roomStatus'`
 *   分不出方向，把关房当开房处理会造成超售。
 *
 * 取值含义是从踩点文档的操作标注反推的（标「关房」那份是 `N`、标「开房」那份是 `G`），
 * 携程没有公开文档。`N` 大概是 `No`，`G` 未知。**只有这两个值是已证实的**，出现第三种取值
 * 时不要猜。
 *
 * ## ⚠️ `roomName` 是 HTML 实体编码的
 *
 * 踩点原文：`"&#24742;&#20139;&#22823;&#24202;&#25151;&lt;&#21333;&#26089;&gt;"`
 * 解码后是「悦享大床房<单早>」。desktop **不解码**（透传原则），RMS 需要展示时自行解码。
 * 定位门店与房型不依赖这个字段，解不解码都不影响正确性。
 *
 * ## 门店怎么定位
 *
 * ```
 * otaHotelId  ✅ 有 —— hotelRoomInfoDtoList[].hotelID
 * ```
 *
 * 与改价老模块 `batchsetroomprice` 同一处境：**一次可能改多家门店**，而契约的 `otaHotelId`
 * 是单值（取第一家）。⚠️ **RMS 必须遍历 `changeRaw.hotelRoomInfoDtoList[].hotelID` 全量
 * 处理**，只认 `otaHotelId` 会漏掉同一次操作里的其他门店。
 *
 * ## 日期与周次要组合展开
 *
 * `dateItemInfoDtoList[]` 给日期区间，`weekDayIndex` 给周次筛选，二者是**交集**关系：
 * 区间内、且周次位为 1 的那些天才生效。desktop 不展开（与改价一致，展开由 RMS 做）。
 *
 * `weekDayIndex` 的位串与改价老模块同构（`"1111001"` 周一→周日），可复用同一套解析。
 *
 * ============================================================================
 * 裁剪：只剔 holidyInfo
 * ============================================================================
 *
 * `dateItemInfoDtoList[].holidyInfo[]` 是携程前端塞进来的**节假日字典**（中秋/国庆/元旦/
 * 春节/清明 5 条，每条含名称与起止日期），用于日历页渲染节假日标记。
 *
 * | | |
 * |---|---|
 * | 与本次改动的关系 | **无** —— 它描述的是节假日本身，不是用户改了哪天的房态 |
 * | 内容是否随操作变化 | 否，是静态字典，每次请求都原样带一遍 |
 * | 剔除理由 | 纯噪音 + 体积（5 条节假日 × 每次上报） |
 *
 * 与改价那边剔 `reqHead`/`cipher`/`head` 是同一口径（无关内容不出本机），差别只在**位置**：
 * 那三个在顶层可以浅层过滤，`holidyInfo` **嵌在数组元素里**，必须逐项重建。
 *
 * 房态请求体里没有 `reqHead`/`cipher`/`head`（那是改价新模块的 SOA 框架字段），所以不必
 * 再剔它们。**除 `holidyInfo` 外一律原样保留**，包括语义未知的 `pageType`/`processType`
 * —— 看不懂不等于没用，透传原则优先。
 *
 * ============================================================================
 * 已知的坑
 * ============================================================================
 *
 * - **响应没有内层明细**：成功样本是 `{code:200, returnCode:"200", data:null, …}`，
 *   `data` 就是 `null`。成功判定只能看外层，**不能**套用改价老模块查
 *   `data.roomPriceSetResults[].resultCode` 的路径 —— 那会把每次成功都判成失败。
 *   判定实现见 `./amount-change-adapter.ts`。
 * - **不是异步任务**：响应里没有 `taskId`，与改价新模块 / 美团不同，`code: 200` 应该就是
 *   已生效（未经二次确认，仅从响应形状推断）。
 * - **响应体不上报**：成败已由适配器的 `isSuccessful` 判过，判失败的根本走不到上报这一步。
 */
import type { JsonObject } from '../../../shared/types/json';

/**
 * 携程房态的 `changeRaw`。
 *
 * 用 `JsonObject` 的宽松形状而非逐字段严格类型，与改价那份同一理由：desktop **忠实透传、
 * 不解读语义**，逐字段建模等于在这里复刻携程的房态语义，而携程随时可能加字段（加了就会被
 * 静默丢弃）。类型的作用是**说明结构**，校验只做到「能不能定位」为止。
 */
export type CtripRoomStatusRaw = JsonObject &
  Readonly<{
    /** `"G"` 开房 / `"N"` 关房 —— 开关的唯一依据，见文件头。 */
    roomStatus?: string;
    /** `{ hotelID, roomTypeID, roomName }` —— 门店与房型都在这里，可能多家门店。 */
    hotelRoomInfoDtoList?: readonly JsonObject[];
    /** `{ startDate, endDate }` —— `holidyInfo` 已被剔除。 */
    dateItemInfoDtoList?: readonly JsonObject[];
    /** `"1111111"` 位串，周一→周日。与日期区间是交集关系。 */
    weekDayIndex?: string;
    /** 与 `roomTypeID` 同一批房型的另一处表达。 */
    originalRoomProductIds?: readonly unknown[];
  }>;

/** 见文件头「裁剪」。嵌在 `dateItemInfoDtoList[]` 元素里，浅层过滤够不着。 */
const DATE_ITEM_NOISE_KEY = 'holidyInfo';

/**
 * 从房态保存请求体构造 `changeRaw`：剔掉 `holidyInfo`，其余原样。
 *
 * 只重建 `dateItemInfoDtoList` 一处，顶层其余键（含语义未知的 `pageType`/`processType`）
 * 一律原样带走 —— 透传原则，看不懂不等于该丢。
 */
export function toCtripRoomStatusRaw(requestBody: JsonObject): CtripRoomStatusRaw {
  const dateItems = requestBody.dateItemInfoDtoList;
  if (!Array.isArray(dateItems)) return requestBody as CtripRoomStatusRaw;

  return {
    ...requestBody,
    dateItemInfoDtoList: dateItems.map((item) => {
      // 非对象元素原样放回：形状不合预期时不该顺手改写它，交给 RMS 看到原文。
      if (typeof item !== 'object' || item === null || Array.isArray(item)) return item;
      const kept: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(item)) {
        if (key === DATE_ITEM_NOISE_KEY) continue;
        kept[key] = value;
      }
      return kept;
    }),
  } as CtripRoomStatusRaw;
}
