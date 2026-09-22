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
 * ## ⛔ 为什么售罄判 `canUsedQuantity` 而不是 `hasInventory`
 *
 * `hasInventory` **在限量场景下恒为 `true`**，拿它判售罄等于写了一条永不触发的死代码。
 * 本地快照库实测：
 *
 * ```
 * limitSale = "T"（限量）的 291 行  → hasInventory 全部为 true，一个 false 都没有
 * hasInventory = false 的 203 行    → 全部落在 limitSale = "F"（不限量）
 * ```
 *
 * 也就是说 `hasInventory` 更像是「**是不是不限量模式**」的副产品，不是「还有没有房」。
 * 渠道文档那句「不要仅凭 `hasInventory` 判无房」说的是**不限量时**别看它 ——
 * 而不限量的行在上面两个 `return` 就已经滤掉了，走到这里它必然是 `true`。
 *
 * 限量场景下可售房量就是 `canUsedQuantity`（渠道文档：`limitSale:"T"` 时才读
 * `totalQuantity` / `canUsedQuantity`）。实测限量的 291 行里它从 0 到 18 都有，
 * 其中 3 行为 0（`roomStatus:"N"`，关房且可售为 0）—— 那正是「售罄」该捕获的。
 */
export function readCtripQuantity(row: JsonObject): QuantityReading {
  // ⚠️ 判读顺序不可颠倒：先 freeSale，再 limitSale。
  if (row.freeSale === 'T') return UNKNOWN;
  if (row.limitSale !== 'T') return UNKNOWN;

  const canUsed = numberOf(row, 'canUsedQuantity');
  return {
    total: numberOf(row, 'totalQuantity'),
    // 限量场景才走到这里，此时房量数字才有意义。
    soldOut: canUsed === 0,
  };
}

/**
 * 美团：先判限量，再算配额。
 *
 * ## ⚠️ 总房量取 `limitRemain + usedCount`
 *
 * ```
 * limitRemain + usedCount  = 用户设的配额   ← 本函数取这个
 * ```
 *
 * 本地快照库实测（201 行）：云憩大床房 15 个日期上该和**恒为 20**（其间 `usedCount`
 * 从 0 变到 5），轻奢标准间恒为 8（`usedCount` 1→5）。
 *
 * **卖出一间时 `limitRemain` −1、`usedCount` +1，和不变** —— 这正是「有订单不误报」
 * 所依赖的不变量。
 *
 * ## ⛔ `remainCount` 是**预留房量**，判据完全不用它
 *
 * 它既不是「剩余可卖」，也不参与任何总量计算。实测值大多为 0、偶尔 1，与
 * `limitRemain`（15/19/39）和 `usedCount` 之间**没有算术关系**：
 *
 * | 房型 | date | `remainCount` | `limitRemain` | `usedCount` |
 * |---|---|---|---|---|
 * | 云舒双床房 | 09-25 | 1 | 39 | 1 |
 * | 云憩大床房 | 09-21 | 0 | 15 | 5 |
 *
 * ⛔ 早期文档里「`remainCount + usedCount` = 物理房量」的说法**不成立**（云舒双床房
 * 算出来是 2，而该房型配额有 40）。不要据此推算任何总量。
 *
 * ⛔ 更不能拿 `remainCount === 0` 判售罄：实测为 0 的 32 行配额都还有剩，
 * 真正售罄（`limitRemain = 0`）只有 1 行。
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
