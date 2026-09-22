/**
 * 从一格的原始数据里读出**房量判据需要的两个数** —— 渠道差异全在本文件。
 *
 * ## 为什么需要它
 *
 * 上报判据要回答两个问题：「总房量变了吗」「可售是不是刚从非 0 变成 0」。两个渠道的
 * 字段名与语义都不同，且**都有「看起来是房量但不是」的字段**，直接在判据里写
 * `itemData.xxx` 会把渠道知识撒得到处都是。
 *
 * ```
 * inventory-report-gate   判据逻辑，渠道无关     「总量变了就报」
 * 本文件                  渠道口径，逻辑无关     「总量怎么算」
 * ```
 *
 * ## ⛔ 本文件是**判据专用**，不改变「整行透传」原则
 *
 * 这里算出来的数字**只用于决定发不发**，绝不写进上报体。上报体依旧是渠道原始行
 * （见 `scan-to-report.ts`）—— 客户端一旦把解读结果混进报文，渠道改字段时服务端
 * 会收到「看起来正常但其实是错的」数据。语义解读仍是服务端的事。
 *
 * ## ⚠️ 读不出来时返回 `null`，判据据此「按变化上报」
 *
 * 渠道改字段名 / 类型不符 / 缺字段，一律 `total: null`。判据遇 `null` 放行上报，
 * 失效方向朝**多报**而不是漏报 —— 多报在日志和服务端都看得见，漏报看不见。
 */
import type { JsonObject } from '../../shared/types/json';

/**
 * 一格的房量读数。
 *
 * ⚠️ `total` 是**用户设定的配额**，不是酒店物理房间数。两者在美团是两个不同的量
 * （见下方 `readMeituanQuantity`），判据关心的是前者：用户改配额是经营动作，
 * 物理房间数不会因为卖了一间就变。
 */
export type QuantityReading = Readonly<{
  /** 总房量（配额）。不限量、字段缺失或类型不符时为 `null`。 */
  total: number | null;
  /** 可售房量是否为 0（真售罄）。⚠️ 不限量时恒为 `false`。 */
  soldOut: boolean;
}>;

export type QuantityReader = (itemData: JsonObject) => QuantityReading;

/** 不限量 / 读不出来时的读数：没有可比的总量，也谈不上售罄。 */
const UNKNOWN: QuantityReading = { total: null, soldOut: false };

/** 取数字。字符串数字也认（渠道偶尔回字符串），取不到返回 `null`。 */
function numberOf(row: JsonObject, field: string): number | null {
  const raw = row[field];
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * 携程：先判不限量，再读数字。
 *
 * ## ⚠️ 判读顺序不可颠倒（渠道文档的「四条反直觉约定」之一）
 *
 * ```
 * freeSale === "T"        → 不限量
 * 否则 limitSale !== "T"  → 不限量
 * 否则                    → 限量，这时房量数字才有意义
 * ```
 *
 * 不限量时 `totalQuantity` / `canUsedQuantity` **本来就是 0**，但实际有房：
 *
 * | 页面显示 | limitSale | freeSale | totalQuantity | 实际 |
 * |---|---|---|---|---|
 * | 限量 剩 7 | `"T"` | — | 9 | 正常限量 |
 * | FS | `"F"` | `"T"` | 0 | **有房** |
 * | 不限 | `"F"` | — | 0 | **有房** |
 *
 * ## ⛔ 为什么不能裸用 `hasInventory`
 *
 * 曾设想「`hasInventory` 是携程自己的有房标记，已内含不限量判读，直接采信即可」。
 * **本地快照库证伪了这个设想**：`canUsedQuantity = 0` 且 `freeSale = "T"` 的 68 行，
 * `hasInventory` **全部为 `false`** —— 不限量的房型在这个字段上与真售罄长得一模一样。
 *
 * 所以 `hasInventory` 只在**确认是限量之后**才拿来判售罄。
 *
 * ## ⛔ 为什么不用 `canUsedQuantity === 0`
 *
 * 同上：它为 0 的行里混着 68 行不限量房。限量场景下它与 `hasInventory` 基本同步
 * （实测仅 3 行不一致），采信渠道自己的结论比自行推导可靠。
 */
export function readCtripQuantity(row: JsonObject): QuantityReading {
  if (row.freeSale === 'T') return UNKNOWN;
  if (row.limitSale !== 'T') return UNKNOWN;

  return {
    total: numberOf(row, 'totalQuantity'),
    // 限量场景才走到这里，此时 hasInventory 就是携程对「还有没有房」的结论。
    soldOut: row.hasInventory === false,
  };
}

/**
 * 美团：先判限量，再算配额。
 *
 * ## ⚠️ 美团有**两个总量**，判据要的是配额那个
 *
 * ```
 * limitRemain + usedCount  = 用户设的配额   ← 本函数取这个
 * remainCount + usedCount  = 物理房量       ← 另一回事，与配额无关
 * ```
 *
 * 本地快照库实测（201 行）：
 *
 * | 房型 | `limitRemain+usedCount` | `remainCount+usedCount` |
 * |---|---|---|
 * | 云憩大床房（15 个日期，usedCount 0→5） | **恒为 20** | 2 / 3 / 5 跳动 |
 * | 轻奢标准间（usedCount 1→5） | **恒为 8** | 3 / 5 跳动 |
 *
 * **卖出一间时 `limitRemain` −1、`usedCount` +1，和不变** —— 这正是「有订单不误报」
 * 所依赖的不变量。用物理房量那个和，卖房时会变，噪音照旧。
 *
 * > `meituan-cells.ts` 里「`remainCount` 与 `usedCount` 一起才能还原出总量」说的是
 * > **物理房量**，两句话都对，但判据要的是配额。
 *
 * ## ⛔ 为什么 `remainCount === 0` 不是售罄
 *
 * 实测 `remainCount = 0` 的 32 行**配额都还有剩**，真正售罄（`limitRemain = 0`）
 * 只有 1 行。拿 `remainCount` 判售罄会误报 32 倍。
 *
 * ## ⚠️ 不限量时 `limitRemain` 是哨兵值，不是房量
 *
 * 渠道文档记的是 998/999，本地库实测到 **1002**（`limitType = 2` 的 15 行全是它）——
 * 说明**哨兵不是固定的几个数**。所以这里判 `limitType`，
 * ⛔ 不做 `limitRemain !== 999` 这类值比较（下次换个哨兵就漏）。
 */
export function readMeituanQuantity(row: JsonObject): QuantityReading {
  // limitType: 1 = 限量，2 = 不限量。非 1 一律按不限量处理 —— 出现新枚举时
  // 宁可不判房量（房态那条判据仍照常上报），也不拿哨兵值当真实房量比大小。
  if (numberOf(row, 'limitType') !== 1) return UNKNOWN;

  const limitRemain = numberOf(row, 'limitRemain');
  const usedCount = numberOf(row, 'usedCount');

  return {
    // 任一缺失就算不出配额 —— 交给判据按「变化」放行，不猜。
    total: limitRemain === null || usedCount === null ? null : limitRemain + usedCount,
    soldOut: limitRemain === 0,
  };
}
