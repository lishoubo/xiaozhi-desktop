/**
 * 美团房态房量读端点 `queryRoomStatusInfo` 的**端点知识** —— 回读与定时扫描共用。
 *
 * ## 两条路径共用的只有这一段
 *
 * ```
 *                 回读（用户改完）              扫描（定时器）
 * 发起      页面内 XHR（executeJavaScript）   主进程 session.fetch
 * 入参来源  用户写请求报文                   房型清单（queryListAndTag）
 * 范围      本次改动命中的房型 × 日期         全店日历房 × 整个窗口
 * 产出      上报体（直接发 RMS）              原始行（交给调度层比对基线）
 *           └──────────────┬──────────────────────────────┘
 *                          ▼ 共用
 *                URL / 请求体形状 / 响应怎么展平
 * ```
 *
 * 各写一份展平逻辑，两条路径抽出的行迟早会漂，而失效方式很隐蔽：同一格被两条路径写成
 * 不同内容，定时扫描于是反复报差异（`inventory-snapshot/types.ts` 已记过这条）。
 *
 * ## ⚠️ 两类过滤分属不同的层
 *
 * | 过滤 | 在哪 | 回读 | 扫描 |
 * |---|---|---|---|
 * | `roomCategory === 1` | **本文件内建** | ✅ | ✅ |
 * | 目标房型 / 目标日期集合 | 本文件的可选入参，**只有回读传** | ✅ | ❌ |
 *
 * **`roomCategory` 内建**，因为它防的不是「范围过大」而是「同一格的两副身份」：同一个
 * `roomId` 会返回日租(1) 与钟点(2) 两行，而格子键里没有 `roomCategory` 这一维 ——
 * 两行会撞同一个键、互相覆盖，`contentHash` 每轮翻覆，报出的差异是假的。
 * 2026-09-21 实测：9 个逻辑房型里 3 个是钟点房，占三分之一，不是边缘情况。
 *
 * ⚠️ 缺失也丢弃：宁可漏读，也不能把钟点房数据混进日历房基线，后者会真实影响下发。
 *
 * **目标集合是回读的语义边界**，不是共用逻辑：回读的产出直接就是上报体，而接口只认
 * 日期区间，用户勾的日期不连续时请求范围必然比目标大 —— 多报一天等于替用户宣告了他
 * 没做的改动（服务端拿 cells 去追价）。扫描没有这回事：比对按格子键逐格查基线，没有
 * 基线的格子自然落进 `added`（只写不报），多读几天是 diff 的正常输入。
 *
 * ## ⚠️ 本文件只到「渠道原始行」为止
 *
 * 产出的是 `JsonObject`，不是 `SnapshotCell` —— 翻译成格子是快照侧的事
 * （eslint 禁止 `channels/` 依赖 `inventory-snapshot/`）。与携程同一条分界线：
 * 本文件**解析**，`inventory-snapshot/meituan-cells.ts` **映射**。
 */
import type { JsonObject } from '../../../shared/types/json';

export const MEITUAN_ROOM_STATUS_URL =
  'https://me.meituan.com/api/gw/v1/product/goods/queryRoomStatusInfo';

/** 日历房。⚠️ 同一 `roomId` 会返回日租(1) + 钟点(2) 两行，见文件头。 */
const ROOM_CATEGORY_DAILY = 1;

/**
 * 请求体。两条路径的**入参来源**不同（回读取自用户报文，扫描取自房型清单），
 * 但形状一样。
 *
 * ⚠️ 接口只认日期**区间**，不认集合。目标日期不连续时按 min~max 发，回来再按集合筛
 * （回读才需要，见 `flattenRoomStatusRows` 的 `narrowTo`）。
 */
export function buildRoomStatusRequest(args: {
  roomIds: readonly number[];
  startDate: string;
  endDate: string;
  poiId: string;
  partnerId: number;
}): JsonObject {
  return {
    roomIds: [...args.roomIds],
    startDate: args.startDate,
    endDate: args.endDate,
    poiId: args.poiId,
    partnerId: args.partnerId,
  };
}

/** 回读专用的收窄范围。扫描不传 —— 它要整个窗口。 */
export type RoomStatusNarrowing = Readonly<{
  roomIds: ReadonlySet<number>;
  dates: ReadonlySet<string>;
}>;

export type FlattenResult = Readonly<{
  rows: JsonObject[];
  /** 被 `roomCategory` 判据挡掉的行数 —— 只用于日志，不影响正确性。 */
  hourlySkipped: number;
}>;

function asObject(value: unknown): JsonObject | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as JsonObject;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const n = Number(value.trim());
    return value.trim() !== '' && Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * 把 `data[]` 的嵌套结构展平成扁平行。
 *
 * ## 展平：`roomStatusMap` 是**以日期为 key 的对象**
 *
 * 携程 `roomStatusResult` 是扁平数组（房型数 × 天数），美团是嵌套 map。展平时把
 * `roomId` / `roomName` / `roomCategory` 并进每一行，让两个渠道的行同构 ——
 * 服务端两边可以一套逻辑处理。
 *
 * @param narrowTo **回读传**，按本次改动的房型与日期收窄；扫描省略即全要。
 */
export function flattenRoomStatusRows(
  /** ⚠️ 收 `unknown`：判成败的那层不再校验形状（它服务多个 `data` 形状不同的端点）。 */
  data: unknown,
  narrowTo?: RoomStatusNarrowing,
): FlattenResult {
  const rows: JsonObject[] = [];
  let hourlySkipped = 0;

  // 这个端点的 `data` 必须是数组；不是就当没读到，交给调用方按空结果处理。
  if (!Array.isArray(data)) return { rows, hourlySkipped };

  for (const rawItem of data) {
    const item = asObject(rawItem);
    if (!item) continue;

    const base = asObject(item.roomBaseInfo);
    if (!base) continue;

    const roomId = toFiniteNumber(base.roomId);
    if (roomId === null) continue;
    if (narrowTo !== undefined && !narrowTo.roomIds.has(roomId)) continue;

    // ⚠️ 日历房才要，**缺失也丢**。两条路径都过这一关 —— 见文件头。
    const roomCategory = toFiniteNumber(base.roomCategory);
    if (roomCategory !== ROOM_CATEGORY_DAILY) {
      if (roomCategory !== null) hourlySkipped += 1;
      continue;
    }

    const statusMap = asObject(item.roomStatusMap);
    if (!statusMap) continue;

    for (const [date, rawCell] of Object.entries(statusMap)) {
      // ⚠️ 按目标日期集合筛，不是「区间内就要」。只有回读传这个。
      if (narrowTo !== undefined && !narrowTo.dates.has(date)) continue;
      const cell = asObject(rawCell);
      if (!cell) continue;

      rows.push({
        roomName: base.roomName ?? null,
        // 整行透传，不解读房量语义 —— 即使已实证 limitRemain 是用户设的那个值
        // （见 inventory-readback-payload.ts），desktop 也不取它，取了美团改字段时
        // 会静默错报。
        ...cell,
        // ⚠️ 这三个放在 spread **之后**：它们来自 `roomBaseInfo`（或 map 的 key），
        // 那才是权威来源。cell 里已经出现过 `containerId` / `date` 这种与 roomBaseInfo
        // 重名的字段，美团哪天补一个 `roomId` 进 cell 并不离谱 —— 若被它覆盖，
        // 一行刚通过 `roomCategory === 1` 过滤的日租数据会带着 `roomCategory: 2`
        // 流下去，静默错报。
        roomId,
        roomCategory,
        date,
      });
    }
  }

  return { rows, hourlySkipped };
}
