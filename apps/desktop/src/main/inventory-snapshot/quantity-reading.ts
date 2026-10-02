/**
 * 只为 scan 上报判据读取可售量，不改变渠道原始行或上报内容。
 * 必须先确认限量模式；不限量时渠道返回的数字可能是 0/999/1002 等哨兵。
 */
import type { JsonObject } from '../../shared/types/json';

export type QuantityReading = Readonly<{
  mode: 'limited' | 'unlimited' | 'unknown';
  /** 仅限量时有效；缺失、非法、负数均为 null，0 是有效值。 */
  available: number | null;
}>;

export type QuantityReader = (itemData: JsonObject) => QuantityReading;

const UNLIMITED: QuantityReading = { mode: 'unlimited', available: null };
const UNKNOWN: QuantityReading = { mode: 'unknown', available: null };

function nonNegativeIntegerOf(row: JsonObject, field: string): number | null {
  const raw = row[field];
  if (typeof raw !== 'number' && (typeof raw !== 'string' || raw.trim() === '')) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function readCtripQuantity(row: JsonObject): QuantityReading {
  // 实测 freeSale=T 时 canUsedQuantity 可以为 0，但它代表不限量而非售罄。
  // hasInventory 在限量样本中恒为 true，不能代替 canUsedQuantity。
  if (row.freeSale === 'T') return UNLIMITED;
  if (row.limitSale === 'F') return UNLIMITED;
  if (row.limitSale !== 'T') return UNKNOWN;
  return { mode: 'limited', available: nonNegativeIntegerOf(row, 'canUsedQuantity') };
}

export function readMeituanQuantity(row: JsonObject): QuantityReading {
  // 限量只认 limitType=1；不限量的 limitRemain 有 998/999/1002 等哨兵。
  // remainCount 是预留房量，usedCount 是已售量，都不是当前可售量。
  const limitType = nonNegativeIntegerOf(row, 'limitType');
  if (limitType === 2) return UNLIMITED;
  if (limitType !== 1) return UNKNOWN;
  return { mode: 'limited', available: nonNegativeIntegerOf(row, 'limitRemain') };
}
