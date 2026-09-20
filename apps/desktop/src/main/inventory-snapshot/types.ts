/**
 * 价量态基线快照的跨层契约。
 *
 * ## 这张表存的是「渠道事实」，不是「本地事实」
 *
 * ```
 * ota_credential / ota_hotel   本地事实：本机的登录态、用户确认过的绑定
 * ota_inventory_snapshot       渠道事实：渠道现在是什么样
 * ```
 *
 * 区别不只是措辞：渠道事实**不需要本地绑定背书**就能存在（用户还没绑定但已经在看的店，
 * 照样要建基线），这就是这张表不加外键的理由。
 *
 * ## 为什么需要它
 *
 * 既有链路全是**被动监听**——用户在本应用里操作 → 旁听写请求 → 上报。前提是「变更必然经过
 * 我们」。两类场景不成立：用户在其他浏览器/手机上改；渠道自行变更（订满自动关房、活动到期）。
 * 两者都没有任何写请求可拦。
 *
 * 主动对账需要一份「渠道当前是什么」的本地基线，与定时取回的最新数据逐格比对——这张表就是
 * 那份基线。比对与上报在 Change B（`add-ota-inventory-scan`），本模块只负责基线本身。
 */
import type { JsonObject } from '../../shared/types/json';

/**
 * 这一格记的是什么。
 *
 * ## ⚠️ 为什么房态与房量不拆成两个值
 *
 * **两个渠道的读模型里它们本就在同一行**：
 *
 * ```
 * 美团 roomStatusMap["2026-09-19"]  { roomStatus, limitType, limitRemain, invSwitch, … }
 * 携程 roomStatusResult[]           { roomStatus, limitSale, totalQuantity, canUsedQuantity, … }
 * ```
 *
 * 拆开等于把渠道返回的一行劈成两格存，比对时再拼回来——凭空多出一次拆分与一次合并，而这
 * 两步都可能写错。与既有 `OtaChangeType` 里 `roomStatus` 不拆房态房量是同一条理由。
 *
 * ## 为什么价格要单独一格
 *
 * 不是因为「接口不同」，而是因为**ID 空间不同**：
 *
 * ```
 * 携程   房态房量 roomTypeID      价格 roomTypeID     同一空间
 * 美团   房态房量 roomId(物理)    价格 goodsId(售卖)  ⚠️ 不同空间，1:多
 * ```
 *
 * 混在一格里，美团侧就没有一个能同时定位两者的房型 ID。
 *
 * 另有一点：携程的价格与房态房量**来自同一响应的两个独立路径**（`roomStatusResult` 与
 * `roomPriceResult`），且价格可能不覆盖全部格子（关房日无价）。合成一格会让「没有价格」
 * 与「这一格不存在」无法区分。
 */
export type SnapshotItemType = 'roomStatus' | 'price';

/**
 * 这一格的数据是哪条路径写进来的。**只用于排查，不参与比对与覆盖仲裁。**
 *
 * ```
 * readback    用户改动后的回读     —— 最可信：刚写完就读回来的
 * page-read   用户浏览页面时旁听   —— 覆盖面随用户翻到哪儿，稀疏
 * scan        定时扫描（Change B） —— 覆盖整个配置窗口
 * ```
 *
 * ⚠️ 本期**不做**按来源的覆盖仲裁（后写的一律覆盖先写的）。明确不追求严格一致性：
 * 定时扫描一次性「取完整批 → 读基线 → 比对 → 写入」，窗口已压到最小，再加仲裁是过度设计。
 * 记录这个字段的成本为零，而它是排查「这格哪来的」的唯一依据。
 */
export type SnapshotSourceOfTruth = 'readback' | 'page-read' | 'scan';

/**
 * 一格快照的唯一标识。
 *
 * ⚠️ **两个房型 ID 不得同时为空**（DB 层有 CHECK 约束兜底）。同时为空的行无法定位房型，
 * 是脏数据。渠道差异体现在填哪一个：
 *
 * ```
 * 携程 roomStatus   sale=roomTypeID   physical=''
 * 携程 price        sale=roomTypeID   physical=''
 * 美团 roomStatus   sale=''           physical=roomId
 * ```
 *
 * ⚠️ **空值用 `''` 不用 `null`**：SQLite 的 `UNIQUE` 约束里 `NULL != NULL`，可空列参与
 * 唯一键会让同一格每次都 INSERT 新行而不是 upsert。类型这一侧跟着 DB 走，避免两边不一致。
 */
export type SnapshotKey = Readonly<{
  source: string;
  /**
   * ⚠️ **取自登录凭证的 `masterHotelId`，不是渠道响应里的酒店 ID。**
   *
   * 携程同一家酒店的预付与现付是两个不同的 hotelID，响应里出现的是本次操作所在的那一侧。
   * 用响应值会让同一家酒店产生多份互不相干的基线，而且 upsert 撞不上唯一键 → 同一房型两行。
   *
   * 既有上报链路已经这么做（`services/amount-change-report-service.ts` 的
   * `resolveOtaHotelId`），回读的 payload 文件也刻意留空串等 service 层覆盖。
   */
  otaHotelId: string;
  /** 物理房型 ID。渠道无此维度时为 `''`。 */
  otaPhysicalRoomId: string;
  /** 售卖房型 ID。渠道无此维度时为 `''`。 */
  otaSaleRoomId: string;
  itemType: SnapshotItemType;
  /** `YYYY-MM-DD`。渠道原样，不做时区转换。 */
  itemDate: string;
}>;

/** 一格快照的完整内容。 */
export type SnapshotCell = SnapshotKey &
  Readonly<{
    /**
     * 渠道返回的原始 cell，**整行原样**。
     *
     * 与既有两处同口径：回读的 `pickCells` 整行透传不裁剪；改价上报只剔框架噪音字段
     * （`reqHead`/`cipher`/`head`），不做任何语义转换。
     *
     * ⚠️ **不转换渠道枚举**（`"G"`/`"N"` 不转开/关，`"T"`/`"F"` 不转布尔）。转换等于在客户端
     * 复刻渠道语义，渠道加字段时会被静默丢弃，而失效方式是「看起来正常但数据是错的」。
     */
    itemData: JsonObject;
    /**
     * 比对用的内容指纹。⚠️ **比它，不比 `itemData` 的 JSON 字符串** ——
     * 后者含渠道噪音（回显参数、内部时间戳）与不稳定的键序，会让没变的格子被判成有差异。
     *
     * 参与字段由各渠道自己定（见 `channels/<渠道>/inventory-snapshot-cells.ts`）。
     */
    contentHash: string;
    /** 数据的观测时刻（毫秒时间戳）。排查用，本期不参与覆盖仲裁。 */
    observedAt: number;
    sourceOfTruth: SnapshotSourceOfTruth;
  }>;

/** 把一格的唯一标识拼成字符串，用于队列去重与索引。分隔符取 `\u0000`，渠道 ID 里不会出现。 */
export function snapshotKeyOf(key: SnapshotKey): string {
  return [
    key.source,
    key.otaHotelId,
    key.otaSaleRoomId,
    key.otaPhysicalRoomId,
    key.itemType,
    key.itemDate,
  ].join('\u0000');
}

/**
 * 两个房型 ID 是否至少有一个有值。DB 有 CHECK 兜底，这里让调用方能在落库前拦掉并告警
 * ——拿到一条「定位不了房型」的数据时，有意义的处置是记下来排查，不是等 DB 抛异常。
 */
export function hasRoomIdentity(key: SnapshotKey): boolean {
  return key.otaPhysicalRoomId !== '' || key.otaSaleRoomId !== '';
}
