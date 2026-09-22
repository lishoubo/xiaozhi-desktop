/**
 * 把美团价量态的**原始行**，转成基线快照的格子。
 *
 * ## ⚠️ 为什么放在 `inventory-snapshot/` 而不是 `channels/meituan/`
 *
 * 它产出的是 `SnapshotCell`（快照领域的类型），而 eslint 禁止 `channels/` 依赖
 * `inventory-snapshot/` —— 渠道层只负责交出**渠道原始行**，把行翻译成格子是快照这一侧
 * 的事。与 `ctrip-cells.ts` 同一条分界线：
 *
 * ```
 * channels/meituan/   认识美团的响应形状 → 交出原始行     （解析）
 * 本文件              认识美团行的字段语义 → 翻译成格子   （映射）
 * ```
 *
 * ## ⚠️ 扫描与自然读**共用这一份**
 *
 * 两条写入路径拿到的是同一批端点的响应：
 *
 * ```
 * 扫描    定时器 → 主进程主动发请求 → 响应
 * 自然读  用户翻日历 → 页面自己发请求 → 我们旁听到响应
 * ```
 *
 * 各写一份抽取逻辑，两条路径抽出的格子迟早会漂（一边改了字段另一边没跟），而失效方式
 * 很隐蔽：同一格被两条路径写成不同内容，定时扫描于是反复报差异。所以**只有这一份**，
 * 且装配层两处（`app-scope` 的扫描链、`window-scope` 的自然读链）必须注册同一个函数。
 *
 * ## ⭐ 两类格子落在**不同的房型 ID 空间**，这是美团与携程最大的差异
 *
 * ```
 * 携程   房态房量 roomTypeID      价格 roomTypeID      同一空间
 * 美团   房态房量 roomId(物理)    价格 goodsId(售卖)   ⚠️ 不同空间，1:多
 * ```
 *
 * ```
 * realRoomId (物理房型)                    ← 房态、房量挂这一层
 *    └── goodsId A (不含早/预付)  ┐
 *    └── goodsId B (含早/到付)    ├─ 价格各自独立
 *    └── goodsId C (专享)         ┘
 * ```
 *
 * 所以：
 *
 * | itemType | `otaPhysicalRoomId` | `otaSaleRoomId` |
 * |---|---|---|
 * | `roomStatus` | `roomId` | `''` |
 * | `price` | `''` | `goodsId` |
 *
 * ⛔ **不要把两类合并到同一个 ID 上**：合并等于丢掉其中一类的定位维度。同一物理房型下
 * 多个售卖商品读到的房态是**同一份事实的重复回显**（踩点实证：同一 `containerId` 下两个
 * goods 的 `goodsStatusMap` 逐字段相同），不是需要仲裁的冲突。
 *
 * ## ⚠️ 钟点房不进基线，但过滤不在本文件
 *
 * 钟点房与日历房**共用同一个 `roomId`**，而 `roomCategory` 不在格子键里 —— 两行会撞同
 * 一个键、互相覆盖，`contentHash` 每轮翻覆，报出的差异是假的。
 *
 * 过滤在**渠道层**完成，与携程同构（它在房型清单那步筛 `hourRoom`/`advanceSale`）：
 *
 * ```
 * ② queryListAndTag  按 roomBaseInfo.roomCategory 筛 → ③④ 入参里就没有钟点房
 * ④ 的响应展平       再兜一道（接口会夹带同 roomId 的钟点房那一行）
 * ```
 *
 * 本文件因此不需要再筛一遍 —— 与 `ctrip-cells.ts` 一致（它也不筛，因为源头已经筛过）。
 *
 * ## 裁剪口径：整行原样，不做白名单
 *
 * `itemData` 宽（整行，便于排查），`contentHash` 窄（只取事实字段）。理由是响应里有随
 * 请求回显的字段与渠道内部字段，它们变化不代表价量态变了 —— 拿整行算 hash 会让没变的
 * 格子被判成有差异，定时扫描于是反复误报。
 *
 * ⚠️ **不转换渠道枚举、不转金额单位**。美团金额是「分」的字符串（`"20700"`），原样存。
 * 转换等于在客户端复刻渠道语义，渠道改字段时会被静默丢弃，而失效方式是「看起来正常但
 * 数据是错的」。语义解读是服务端的事。
 */
import type { JsonObject } from '../../shared/types/json';
import type { SnapshotCell, SnapshotSourceOfTruth } from './types';

export const MEITUAN_SOURCE = 'meituan';

/**
 * 参与房态房量 `contentHash` 的字段 —— **美团房态房量的事实字段**。
 *
 * ⚠️ 顺序即 hash 的拼接顺序，**不要改动**（改了会让全部既有基线的 hash 失效，
 * 下一轮扫描把整个窗口判成变更）。加字段追加到末尾。
 *
 * | 字段 | 为什么必须参与 |
 * |---|---|
 * | `roomStatus` | 房态本身 |
 * | `limitType` | 是否限量 —— 它变了，`limitRemain` 的含义就变了 |
 * | `limitRemain` | ⚠️ 是「配额 − 已售」，**不是**用户设的配额本身 |
 * | `remainCount` | **预留房量**。⛔ 不是「剩余可卖」，判据不用它 |
 * | `usedCount` | 已售 |
 * | `invSwitch` | 房态开关 |
 *
 * ⚠️ **总房量 = `limitRemain + usedCount`**（本地快照库 201 行实测）：云憩大床房
 * 15 个日期上该和恒为 20，其间 `usedCount` 从 0 变到 5 —— 卖出一间时
 * `limitRemain` −1、`usedCount` +1，和不变。上报判据据此区分「用户改配额」与
 * 「正常销售」，实现见 `quantity-reading.ts`。
 *
 * ⛔ `remainCount` 是预留房量，与配额无算术关系（实测多为 0、偶尔 1，而同格
 * `limitRemain` 可达 39）。早期文档「`remainCount + usedCount` = 物理房量」的说法
 * **不成立**，不要据此推算总量。
 *
 * ⛔ **不含 `containerId`**：渠道内部标识，它变化不代表房态变了。
 * ⛔ **不含 `shareType`**：语义未踩点，不确定它变化是否构成事实变更。
 * ⛔ **不含 `date` / `roomId`**：已经在格子键里。
 *
 * ⚠️ `remainCount` / `usedCount` 必须参与 —— 它们只有 `queryRoomStatusInfo` 才返回，
 * 而 `queryPriceInventoryStatusInfo` 的 `goodsStatusMap` 里没有。扫描之所以额外发一次
 * 前者而不复用后者，正是为了这两个字段（见 `channels/meituan/inventory-scan.ts` 文件头）。
 */
const ROOM_STATUS_HASH_FIELDS: readonly string[] = [
  'roomStatus',
  'limitType',
  'limitRemain',
  'remainCount',
  'usedCount',
  'invSwitch',
];

/**
 * 参与价格 `contentHash` 的字段。
 *
 * ⚠️ 与房态那组**分开**：价格行的字段名完全不同，混用一组字段会让两类格子的 hash 都恒为
 * 全 `~`（字段都取不到），于是**任何变化都测不出**。
 *
 * | 字段 | 含义 |
 * |---|---|
 * | `salePrice` | 卖价（分） |
 * | `basePrice` | 底价（分） |
 * | `originPrice` | 划线价（分） |
 * | `subRatio` | 佣金率（万分位，如 `1300` = 13%） |
 *
 * ⛔ **不含 `subPrice`**：它是 `salePrice × subRatio` 的结果，随两者变化，
 * 参与进来等于把同一个事实数两遍。
 */
const PRICE_HASH_FIELDS: readonly string[] = [
  'salePrice',
  'basePrice',
  'originPrice',
  'subRatio',
];

/**
 * 我们打在行上的分流标记（由渠道层加），**不是美团字段**。
 * 剥掉后才存进 `item_data` —— 否则基线里会混入一个渠道没有的字段。
 *
 * ⚠️ **必须与 `channels/meituan/inventory-scan.ts` 的 `MEITUAN_SCAN_KIND_MARKER`
 * 逐字符相同**。两处各写一份字面量是**有意的**（eslint 禁止 `channels/` 依赖本目录），
 * 由一条跨模块断言测试钉住 —— 不一致时映射侧会把所有行都当成房态，**价格格子静默消失**，
 * 而日志上看不出任何异常。
 */
export const MEITUAN_SNAPSHOT_KIND_MARKER = '__snapshotKind';
const KIND_MARKER = MEITUAN_SNAPSHOT_KIND_MARKER;

/**
 * 自然读那条路会随行带出门店标识（美团的 `poiId` 只在请求里，响应里没有）。
 * 与分流标记一样是**我们自己加的**，剥掉后才存进 `item_data`。
 *
 * ⚠️ 不剥的话基线里会混进一个渠道没有的字段 —— 而它不参与 `contentHash`，
 * 所以不会引发误报，只是让 `item_data` 不再是「渠道原样」，排查时容易被当成渠道字段。
 */
const CARRIED_FIELDS: readonly string[] = [KIND_MARKER, '__otaHotelId'];

/**
 * 内容指纹。取字段的**稳定拼接**而非 `JSON.stringify(整行)`。
 *
 * ⚠️ 不用 `JSON.stringify` 整行的两个理由：键序不稳定（同样内容可能算出不同 hash）、
 * 含噪音字段（没变也会触发差异）。这里按固定顺序取固定字段，两个问题都不存在。
 *
 * 缺失与 `null` 都记成 `~`，与字符串 `"null"` 区分开 —— 否则渠道把字段从缺失改成显式
 * null 时会被判成变更。
 *
 * ⚠️ 数字与字符串**不归一**：`String(20700)` 与 `String("20700")` 本就相同，而刻意把
 * `"20700"` 转成数字再转回来，反而会在渠道改类型时掩盖掉真实的类型变化。
 */
export function meituanContentHash(row: JsonObject, fields: readonly string[]): string {
  return fields
    .map((field) => {
      const value = row[field];
      if (value === undefined || value === null) return '~';
      return String(value);
    })
    .join('|');
}

/** 取 ID：数字或非空字符串，取不到返回 `''`（调用方据此跳过该行）。 */
function idOf(row: JsonObject, field: string): string {
  const raw = row[field];
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  if (typeof raw === 'string' && raw.trim() !== '') return raw.trim();
  return '';
}

/** 取房型名。⚠️ 纯标注字段，**不校验不加工** —— 渠道给什么就写什么。 */
function nameOf(row: JsonObject, field: string): string | undefined {
  const raw = row[field];
  return typeof raw === 'string' ? raw : undefined;
}

/** 剥掉我们自己加的分流标记 —— `item_data` 只存渠道原字段。 */
function withoutMarker(row: JsonObject): JsonObject {
  if (!CARRIED_FIELDS.some((field) => field in row)) return row;
  const rest: Record<string, JsonObject[string]> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!CARRIED_FIELDS.includes(key)) rest[key] = value;
  }
  return rest;
}

/**
 * 房态房量行 → 格子。
 *
 * ⚠️ 房型 ID 填 `physical`（`roomId`），`sale` 留空 —— 美团的房态房量挂在**物理房型**上。
 */
function toRoomStatusCell(
  row: JsonObject,
  otaHotelId: string,
  sourceOfTruth: SnapshotSourceOfTruth,
  observedAt: number,
  dates?: ReadonlySet<string>,
): SnapshotCell | null {
  const itemDate = row.date;
  if (typeof itemDate !== 'string' || itemDate === '') return null;
  if (dates !== undefined && !dates.has(itemDate)) return null;

  const otaPhysicalRoomId = idOf(row, 'roomId');
  if (otaPhysicalRoomId === '') return null;

  const data = withoutMarker(row);
  return {
    source: MEITUAN_SOURCE,
    otaHotelId,
    otaPhysicalRoomId,
    otaSaleRoomId: '',
    itemType: 'roomStatus',
    itemDate,
    itemData: data,
    contentHash: meituanContentHash(data, ROOM_STATUS_HASH_FIELDS),
    observedAt,
    sourceOfTruth,
    // 房态挂物理房型，名字取 `roomName`（渠道行自带）。
    roomName: nameOf(row, 'roomName'),
  };
}

/**
 * 价格行 → 格子。
 *
 * ⚠️ 房型 ID 填 `sale`（`goodsId`），`physical` 留空 —— 美团的价格挂在**售卖商品**上。
 * 这与房态那类**刚好相反**，是本文件最容易写错的地方。
 */
function toPriceCell(
  row: JsonObject,
  otaHotelId: string,
  sourceOfTruth: SnapshotSourceOfTruth,
  observedAt: number,
  dates?: ReadonlySet<string>,
): SnapshotCell | null {
  const itemDate = row.date;
  if (typeof itemDate !== 'string' || itemDate === '') return null;
  if (dates !== undefined && !dates.has(itemDate)) return null;

  const otaSaleRoomId = idOf(row, 'goodsId');
  if (otaSaleRoomId === '') return null;

  const data = withoutMarker(row);
  return {
    source: MEITUAN_SOURCE,
    otaHotelId,
    otaPhysicalRoomId: '',
    otaSaleRoomId,
    itemType: 'price',
    itemDate,
    itemData: data,
    contentHash: meituanContentHash(data, PRICE_HASH_FIELDS),
    observedAt,
    sourceOfTruth,
    // ⚠️ 价格挂售卖商品，名字取 `goodsName`（不是 `roomName`）——
    // 同一物理房型下多个商品各有各的名字，取错会让所有商品显示成同一个名。
    roomName: nameOf(row, 'goodsName'),
  };
}

/**
 * 把**已带分流标记**的行转成格子 —— 扫描与自然读共用的入口。
 *
 * @param otaHotelId ⚠️ 美团取**已绑定门店**的 `poiId`（由装配层补齐），
 *        不是凭证的 `masterHotelId`（美团根本没有那个字段）。
 *
 * @param dates 若给定，只保留这些日期的行。扫描不传（要整个窗口）。
 *
 * ⚠️ 未带标记的行按房态处理：标记是我们自己加的，缺失说明打标记那侧漏了，
 * 而房态是两类里更基础的那类。⛔ 但这只是兜底 —— 真正的保障是那条跨模块断言测试。
 */
export function mapMeituanReadRows(
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
        : toRoomStatusCell(row, otaHotelId, sourceOfTruth, observedAt, dates);
    if (cell) cells.push(cell);
  }
  return cells;
}
