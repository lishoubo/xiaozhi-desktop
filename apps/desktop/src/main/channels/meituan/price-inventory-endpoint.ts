/**
 * 美团价格读端点 `queryPriceInventoryStatusInfo` 的**端点知识**。
 *
 * 与 `room-status-endpoint.ts` 同级、同理由：这个端点被**定时扫描**与**自然读**两条路径
 * 共用（扫描主动发，用户翻价量态日历时页面自己也发），展平逻辑各写一份迟早会漂 ——
 * 同一格被两条路径写成不同内容，定时扫描于是反复报差异。
 *
 * ## ⚠️ 只读 `goodsPriceMap`，不读同响应里的 `goodsStatusMap`
 *
 * 这个响应里其实带房态，但**字段集比 `queryRoomStatusInfo` 少两个**
 * （缺 `remainCount` / `usedCount`）。用它建房态基线，会让同一格的 `contentHash` 在
 * 「扫描/自然读」与「回读」两条路上不同 —— 每轮扫描都把回读刚写的格子判成有差异。
 *
 * 详见 `inventory-scan.ts` 文件头的对照表。房态一律走 `room-status-endpoint.ts`。
 *
 * ## ⚠️ 本文件只到「渠道原始行」为止
 *
 * 产出 `JsonObject` 而非 `SnapshotCell` —— 翻译成格子是快照侧的事
 * （eslint 禁止 `channels/` 依赖 `inventory-snapshot/`）。
 */
import type { JsonObject } from '../../../shared/types/json';

export const MEITUAN_PRICE_INVENTORY_URL =
  'https://me.meituan.com/api/gw/v1/product/goods/queryPriceInventoryStatusInfo';

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
 * 从价格读端点的响应里展平价格行。
 *
 * ⚠️ **只读 `goodsPriceMap`，不读 `goodsStatusMap`** —— 理由见文件头。
 */
export function flattenPriceRows(data: unknown): JsonObject[] {
  const rows: JsonObject[] = [];
  // 这个端点的 `data` 必须是数组；不是就当没读到（判成败那层不再校验形状）。
  if (!Array.isArray(data)) return rows;
  for (const rawItem of data) {
    const item = asObject(rawItem);
    if (!item) continue;
    const base = asObject(item.goodsBaseInfo);
    const goodsId = base === null ? null : toFiniteNumber(base.goodsId);
    if (goodsId === null) continue;

    const priceMap = asObject(item.goodsPriceMap);
    if (!priceMap) continue;

    for (const [date, rawList] of Object.entries(priceMap)) {
      // 每个日期是一个数组，取第一条 —— 与 RMS RPA 侧同口径。
      if (!Array.isArray(rawList)) continue;
      const cell = asObject(rawList[0]);
      if (!cell) continue;
      rows.push({
        goodsName: base?.goodsName ?? null,
        // 整行透传，不解读价格语义、**不转金额单位**（渠道给的是「分」的字符串）。
        // 转换等于在客户端复刻渠道语义，渠道改字段时会静默错报。
        ...cell,
        // ⚠️ 放在 spread 之后：goodsId 与 date 的权威来源是 goodsBaseInfo 与 map 的 key，
        // 不是 cell 自己回显的那份。
        goodsId,
        date,
      });
    }
  }
  return rows;
}
