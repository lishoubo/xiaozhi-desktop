/**
 * 把携程价量态读接口的**原始行**，转成基线快照的格子。
 *
 * ## ⚠️ 为什么放在 `inventory-snapshot/` 而不是 `channels/ctrip/`
 *
 * 它产出的是 `SnapshotCell`（快照领域的类型），而 eslint 禁止 `channels/` 依赖
 * `inventory-snapshot/` —— 渠道层只负责交出**渠道原始行**（`onReadResponse` 与回读的
 * `cells` 都是），把行翻译成格子是快照这一侧的事。
 *
 * 分界线因此很清楚：
 *
 * ```
 * channels/ctrip/   认识携程的响应形状 → 交出原始行
 * 本文件            认识携程行的字段语义 → 翻译成格子
 * ```
 *
 * 两者都带「携程知识」，但方向相反：前者是**解析**，后者是**映射**。
 *
 * ## ⚠️ 回读与自然读**共用这一份**
 *
 * 两条写入路径拿到的是**同一个端点**（`getRoomInventoryInfo`）的响应：
 *
 * ```
 * 回读    用户改完 → 我们主动发请求 → 响应
 * 自然读  用户翻日历 → 页面自己发请求 → 我们旁听到响应
 * ```
 *
 * 各写一份抽取逻辑，两条路径抽出的 cells 迟早会漂（一边改了字段另一边没跟），而失效方式
 * 很隐蔽：同一格被两条路径写成不同内容，定时扫描于是反复报差异。所以**只有这一份**。
 *
 * ## 裁剪口径：整行原样，不做白名单
 *
 * 与既有两处一致：
 *
 * | 处 | 做法 |
 * |---|---|
 * | `inventory-readback.ts` 的 `pickCells` | `roomStatusResult` 的行**整条透传**，不裁剪 |
 * | `amount-change-payload.ts` | 只剔框架噪音（`reqHead`/`cipher`/`head`），不做语义转换 |
 *
 * 这个响应里没有框架噪音字段（噪音在**请求**体上），所以 `itemData` 就是整行原样。
 *
 * ⚠️ **不转换渠道枚举**：`"G"`/`"N"`/`"Y"` 不转开/关，`"T"`/`"F"` 不转布尔。转换等于在
 * 客户端复刻携程的房态语义，而携程随时可能加枚举值——加了就会被静默归错类。语义解读是
 * 服务端的事，字段含义见 `inventory-readback-payload.ts`。
 *
 * ## `contentHash` 取窄字段集，与 `itemData` 不同口径
 *
 * `itemData` 宽（整行，便于排查），`contentHash` 窄（只取价量态事实）。理由是响应里
 * 有随请求回显的字段与渠道内部字段，它们变化不代表房态房量变了——拿整行算 hash 会让
 * 没变的格子被判成有差异，定时扫描于是反复误报。
 */
import type { JsonObject } from '../../shared/types/json';
import type { SnapshotCell, SnapshotSourceOfTruth } from './types';

export const CTRIP_SOURCE = 'ctrip';

/**
 * 参与 `contentHash` 的字段 —— **携程房态房量的事实字段**。
 *
 * ⚠️ 顺序即 hash 的拼接顺序，**不要改动**（改了会让全部既有基线的 hash 失效，
 * 下一轮扫描把整个窗口判成变更）。加字段追加到末尾。
 *
 * 为什么是这几个，见 `inventory-readback-payload.ts` 的「四条反直觉约定」：
 *
 * | 字段 | 为什么必须参与 |
 * |---|---|
 * | `roomStatus` | 房态本身（`"G"` 开 / `"N"` 系统关 / `"Y"` 手动关） |
 * | `limitSale` | 是否限量。⚠️ `"F"` 时房量 0 **不代表没房** |
 * | `freeSale` | FreeSale 标记。判读顺序：先看它，再看 `limitSale` |
 * | `totalQuantity` / `canUsedQuantity` | 房量 |
 * | `hasInventory` | 携程自己的有房标记 |
 *
 * ⛔ **不含 `hotelID`**：它是「门店 × 售卖模式」层的标识，同店预付/现付不同值。它变化
 * 不代表房态变了，且格子的门店维度已由 `otaHotelId`（取自凭证）承担。
 */
const HASH_FIELDS: readonly string[] = [
  'roomStatus',
  'limitSale',
  'freeSale',
  'totalQuantity',
  'canUsedQuantity',
  'hasInventory',
];

/**
 * 参与价格格子 `contentHash` 的字段。
 *
 * ⚠️ 与房态那组**分开**：价格行的字段名完全不同（`price` / `originalPrice`），
 * 混用一组字段会让两类格子的 hash 都恒为全 `~`（字段都取不到），于是**任何变化都测不出**。
 *
 * 取 `price` 不取 `originalPrice`：后者偏低约 2%，不是实际售价。
 */
const PRICE_HASH_FIELDS: readonly string[] = ['price', 'currency'];

/**
 * 我们打在行上的分流标记（由渠道适配器加），**不是携程字段**。
 * 剥掉后才存进 `item_data` —— 否则基线里会混入一个渠道没有的字段。
 *
 * ⚠️ **导出**给打标记的那一侧用（`channels/ctrip/` 下的改价适配器与扫描实现）：
 * 两边各写一份字面量的话，改了一边另一边会静默把所有行都当成房态。
 */
export const CTRIP_SNAPSHOT_KIND_MARKER = '__snapshotKind';
const KIND_MARKER = CTRIP_SNAPSHOT_KIND_MARKER;

/**
 * 扫描侧随行贴上的房型名（携程的房型名只在房型清单里，房态/价格行里只有 `roomTypeID`）。
 * 读进 `SnapshotCell.roomName` 后**从 `item_data` 里剥掉** —— 与分流标记同样处置，
 * `item_data` 只存渠道原字段。
 *
 * ⚠️ 与 `channels/ctrip/inventory-scan.ts` 的 `CTRIP_SCAN_ROOM_NAME_FIELD` 必须逐字符
 * 相同，由跨模块断言测试钉住。
 *
 * ⚠️ 自然读那条路没有房型清单，拿不到名字 —— 那条路写的格子 `roomName` 为空。
 */
export const CTRIP_SNAPSHOT_ROOM_NAME_FIELD = '__roomName';
const ROOM_NAME_FIELD = CTRIP_SNAPSHOT_ROOM_NAME_FIELD;

/**
 * 内容指纹。取字段的**稳定拼接**而非 `JSON.stringify(整行)`。
 *
 * ⚠️ 不用 `JSON.stringify` 整行的两个理由：键序不稳定（同样内容可能算出不同 hash）、
 * 含噪音字段（没变也会触发差异）。这里按固定顺序取固定字段，两个问题都不存在。
 *
 * 缺失与 `null` 都记成 `~`，与字符串 `"null"` 区分开 —— 否则渠道把字段从缺失改成显式
 * null 时会被判成变更。
 */
export function ctripContentHash(
  row: JsonObject,
  fields: readonly string[] = HASH_FIELDS,
): string {
  return fields.map((field) => {
    const value = row[field];
    if (value === undefined || value === null) return '~';
    return String(value);
  }).join('|');
}

/**
 * 从 `getRoomInventoryInfo` 的响应 `data` 抽出房态房量格子。
 *
 * @param otaHotelId ⚠️ **取自凭证的 `masterHotelId`**，由装配层补齐。
 *        ⛔ 绝不能用响应里的 `hotelID` —— 那是「门店 × 售卖模式」层，同店预付/现付两个值，
 *        用它会让同一家酒店产生多份互不相干的基线，且 upsert 撞不上唯一键 → 同一房型两行。
 *
 * @param dates 若给定，只保留这些日期的行（回读用：请求按 min~max 区间发，返回的是区间内
 *        每一天，而用户可能只改了周末）。不给则全收（自然读用：用户翻到什么就存什么）。
 *
 * ⚠️ 两个房型 ID：携程填 `sale`（`roomTypeID`），`physical` 留空 —— 携程的房态房量与价格
 * 都按 `roomTypeID` 索引，没有物理/售卖之分。
 */
export function extractCtripSnapshotCells(
  data: unknown,
  otaHotelId: string,
  sourceOfTruth: SnapshotSourceOfTruth,
  observedAt: number,
  dates?: ReadonlySet<string>,
): readonly SnapshotCell[] {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return [];
  const rows = (data as JsonObject).roomStatusResult;
  if (!Array.isArray(rows)) return [];

  const cells: SnapshotCell[] = [];
  for (const row of rows) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) continue;
    const cell = toSnapshotCell(row as JsonObject, otaHotelId, sourceOfTruth, observedAt, dates);
    if (cell) cells.push(cell);
  }
  return cells;
}

/**
 * 把**已带分流标记**的行（渠道适配器 `onReadResponse` 的产物）转成格子。
 *
 * 与上面那个的区别只在入口形状：这个吃扁平行列表，那个吃整个 `data` 对象。两者共用
 * `toSnapshotCell`，所以房态格子的字段语义只有一处定义。
 */
export function mapCtripReadRows(
  rows: readonly JsonObject[],
  otaHotelId: string,
  sourceOfTruth: SnapshotSourceOfTruth,
  observedAt: number,
  dates?: ReadonlySet<string>,
): readonly SnapshotCell[] {
  const cells: SnapshotCell[] = [];
  for (const row of rows) {
    const cell =
      row[KIND_MARKER] === 'price'
        ? toPriceCell(row, otaHotelId, sourceOfTruth, observedAt, dates)
        : toSnapshotCell(row, otaHotelId, sourceOfTruth, observedAt, dates);
    if (cell) cells.push(cell);
  }
  return cells;
}

/** 房型 ID：数字或非空字符串，取不到返回 `''`（调用方据此跳过该行）。 */
function roomTypeIdOf(cell: JsonObject): string {
  const raw = cell.roomTypeID;
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  if (typeof raw === 'string' && raw.trim() !== '') return raw.trim();
  return '';
}

/** 我们自己加在行上的字段 —— 都要剥掉，`item_data` 只存渠道原字段。 */
const CARRIED_FIELDS: readonly string[] = [KIND_MARKER, ROOM_NAME_FIELD];

/** 剥掉我们自己加的字段 —— `item_data` 只存渠道原字段。 */
function withoutMarker(cell: JsonObject): JsonObject {
  if (!CARRIED_FIELDS.some((field) => field in cell)) return cell;
  const rest: Record<string, JsonObject[string]> = {};
  for (const [key, value] of Object.entries(cell)) {
    if (!CARRIED_FIELDS.includes(key)) rest[key] = value;
  }
  return rest;
}

/** 取房型名。⚠️ 纯标注字段，**不校验不加工** —— 贴的时候是什么就是什么。 */
function nameOf(cell: JsonObject): string | undefined {
  const raw = cell[ROOM_NAME_FIELD];
  return typeof raw === 'string' ? raw : undefined;
}

function toSnapshotCell(
  cell: JsonObject,
  otaHotelId: string,
  sourceOfTruth: SnapshotSourceOfTruth,
  observedAt: number,
  dates?: ReadonlySet<string>,
): SnapshotCell | null {
  const effectDate = cell.effectDate;
  if (typeof effectDate !== 'string' || effectDate === '') return null;
  if (dates !== undefined && !dates.has(effectDate)) return null;

  const otaSaleRoomId = roomTypeIdOf(cell);
  if (otaSaleRoomId === '') return null;

  const data = withoutMarker(cell);
  return {
    source: CTRIP_SOURCE,
    otaHotelId,
    otaPhysicalRoomId: '',
    otaSaleRoomId,
    itemType: 'roomStatus',
    itemDate: effectDate,
    itemData: data,
    contentHash: ctripContentHash(data),
    observedAt,
    sourceOfTruth,
    roomName: nameOf(cell),
  };
}

/**
 * 价格行 → 价格格子。
 *
 * ⚠️ 日期字段名与房态行**不同**：价格行用 `effectDate`，但部分响应里是 `date`。
 * 两个都认，取到哪个算哪个 —— 认错会让整批价格静默丢失。
 */
function toPriceCell(
  cell: JsonObject,
  otaHotelId: string,
  sourceOfTruth: SnapshotSourceOfTruth,
  observedAt: number,
  dates?: ReadonlySet<string>,
): SnapshotCell | null {
  const rawDate = cell.effectDate ?? cell.date;
  if (typeof rawDate !== 'string' || rawDate === '') return null;
  if (dates !== undefined && !dates.has(rawDate)) return null;

  const otaSaleRoomId = roomTypeIdOf(cell);
  if (otaSaleRoomId === '') return null;

  const data = withoutMarker(cell);
  return {
    source: CTRIP_SOURCE,
    otaHotelId,
    otaPhysicalRoomId: '',
    otaSaleRoomId,
    itemType: 'price',
    itemDate: rawDate,
    itemData: data,
    contentHash: ctripContentHash(data, PRICE_HASH_FIELDS),
    observedAt,
    sourceOfTruth,
    roomName: nameOf(cell),
  };
}
