/**
 * scan 差异的上报判据。只决定发不发；上报体仍由 scan-to-report 透传原始渠道行。
 * 价格与房态变化照常上报。限量房量按可售整数比较，不按总量或售罄跃迁比较。
 */
import type { JsonObject } from '../../shared/types/json';
import type { SnapshotChange } from './snapshot-diff';
import type { QuantityReader } from './quantity-reading';

const ROOM_STATUS_FIELDS: Readonly<Record<string, readonly string[]>> = {
  ctrip: ['roomStatus'],
  meituan: ['roomStatus', 'invSwitch'],
};

function roomStatusChanged(source: string, latest: JsonObject, baseline: JsonObject): boolean {
  const fields = ROOM_STATUS_FIELDS[source];
  if (fields === undefined) return false;
  return fields.some((field) => String(latest[field] ?? '~') !== String(baseline[field] ?? '~'));
}

export type UnreliableQuantityReason = 'unknown-mode' | 'invalid-available';

export function shouldReport(
  change: SnapshotChange,
  readQuantity: QuantityReader | undefined,
  onUnreliable?: (reason: UnreliableQuantityReason) => void,
): boolean {
  if (change.latest.itemType !== 'roomStatus') return true;
  if (readQuantity === undefined) return true;

  const latest = change.latest.itemData;
  const baseline = change.baseline.itemData;
  if (roomStatusChanged(change.latest.source, latest, baseline)) return true;

  const current = readQuantity(latest);
  const previous = readQuantity(baseline);
  if (current.mode !== previous.mode) {
    if (current.mode === 'unknown' || previous.mode === 'unknown') onUnreliable?.('unknown-mode');
    return true;
  }
  if (current.mode === 'unlimited') return false;
  if (current.mode === 'unknown') {
    onUnreliable?.('unknown-mode');
    return true;
  }
  if (current.available === null || previous.available === null) {
    onUnreliable?.('invalid-available');
    return true;
  }
  return current.available !== previous.available;
}
