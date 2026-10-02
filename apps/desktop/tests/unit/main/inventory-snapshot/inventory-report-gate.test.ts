import { describe, expect, it, vi } from 'vitest';
import { shouldReport } from '../../../../src/main/inventory-snapshot/inventory-report-gate';
import {
  readCtripQuantity,
  readMeituanQuantity,
} from '../../../../src/main/inventory-snapshot/quantity-reading';
import type { SnapshotChange } from '../../../../src/main/inventory-snapshot/snapshot-diff';
import type { JsonObject } from '../../../../src/shared/types/json';
import type { SnapshotCell } from '../../../../src/main/inventory-snapshot/types';

function change(
  source: string,
  before: JsonObject,
  after: JsonObject,
  itemType: 'roomStatus' | 'price' = 'roomStatus',
): SnapshotChange {
  const cell = (itemData: JsonObject): SnapshotCell => ({
    source,
    otaHotelId: 'h1',
    otaPhysicalRoomId: '',
    otaSaleRoomId: 'r1',
    itemType,
    itemDate: '2026-10-20',
    itemData,
    contentHash: JSON.stringify(itemData),
    observedAt: 1,
    sourceOfTruth: 'scan',
  });
  return { baseline: cell(before), latest: cell(after) };
}

const ctrip = (available: number, total = 5) => ({
  roomStatus: 'G',
  limitSale: 'T',
  freeSale: 'F',
  totalQuantity: total,
  canUsedQuantity: available,
});
const meituan = (available: number, usedCount = 0) => ({
  roomStatus: 1,
  invSwitch: 1,
  limitType: 1,
  limitRemain: available,
  usedCount,
});

describe('scan roomStatus 上报判据', () => {
  it('美团普通销售 5→4 和订单取消 0→1 均上报', () => {
    expect(shouldReport(change('meituan', meituan(5, 0), meituan(4, 1)), readMeituanQuantity)).toBe(
      true,
    );
    expect(shouldReport(change('meituan', meituan(0, 5), meituan(1, 4)), readMeituanQuantity)).toBe(
      true,
    );
  });

  it('携程普通销售与售罄恢复均上报', () => {
    expect(shouldReport(change('ctrip', ctrip(5), ctrip(4)), readCtripQuantity)).toBe(true);
    expect(shouldReport(change('ctrip', ctrip(1), ctrip(0)), readCtripQuantity)).toBe(true);
    expect(shouldReport(change('ctrip', ctrip(0), ctrip(1)), readCtripQuantity)).toBe(true);
  });

  it('可售不变时总量或已售变化不单独触发上报', () => {
    expect(shouldReport(change('ctrip', ctrip(4, 5), ctrip(4, 8)), readCtripQuantity)).toBe(false);
    expect(shouldReport(change('meituan', meituan(4, 1), meituan(4, 2)), readMeituanQuantity)).toBe(
      false,
    );
  });

  it('可售持续 0 且房态不变不重复上报', () => {
    expect(shouldReport(change('ctrip', ctrip(0, 5), ctrip(0, 8)), readCtripQuantity)).toBe(false);
  });

  it('限量与不限量双向切换上报，不限量哨兵变化不上报', () => {
    const unlimited = { roomStatus: 1, invSwitch: 1, limitType: 2, limitRemain: 999 };
    expect(shouldReport(change('meituan', meituan(5), unlimited), readMeituanQuantity)).toBe(true);
    expect(shouldReport(change('meituan', unlimited, meituan(5)), readMeituanQuantity)).toBe(true);
    expect(
      shouldReport(
        change('meituan', unlimited, { ...unlimited, limitRemain: 1002 }),
        readMeituanQuantity,
      ),
    ).toBe(false);
    expect(
      shouldReport(
        change('ctrip', ctrip(5), { roomStatus: 'G', limitSale: 'F', canUsedQuantity: 0 }),
        readCtripQuantity,
      ),
    ).toBe(true);
  });

  it('不可读数保守上报并报告原因，未知模式不当作限量', () => {
    const onUnreliable = vi.fn();
    expect(
      shouldReport(
        change('ctrip', ctrip(5), { ...ctrip(5), canUsedQuantity: -1 }),
        readCtripQuantity,
        onUnreliable,
      ),
    ).toBe(true);
    expect(onUnreliable).toHaveBeenCalledWith('invalid-available');
    expect(
      shouldReport(
        change('meituan', meituan(5), { ...meituan(5), limitType: 9 }),
        readMeituanQuantity,
        onUnreliable,
      ),
    ).toBe(true);
    expect(onUnreliable).toHaveBeenCalledWith('unknown-mode');
  });

  it('房态和价格维持原判据', () => {
    expect(
      shouldReport(change('ctrip', ctrip(5), { ...ctrip(5), roomStatus: 'N' }), readCtripQuantity),
    ).toBe(true);
    expect(
      shouldReport(
        change('meituan', meituan(5), { ...meituan(5), invSwitch: 0 }),
        readMeituanQuantity,
      ),
    ).toBe(true);
    expect(
      shouldReport(change('ctrip', { price: 100 }, { price: 120 }, 'price'), readCtripQuantity),
    ).toBe(true);
    expect(
      shouldReport(change('douyin', { roomStatus: 1 }, { roomStatus: 1, foo: 2 }), undefined),
    ).toBe(true);
  });
});
