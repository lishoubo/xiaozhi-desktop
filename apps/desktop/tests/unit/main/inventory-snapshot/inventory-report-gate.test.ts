/**
 * 上报判据的单测。
 *
 * ⚠️ 这里的场景全部对应真机观察到的现象：噪音来自「有订单时房量本来就会变」，
 * 而要保住的信号是「用户改配额」与「最后一间售出」。
 */
import { describe, expect, it } from 'vitest';
import { shouldReport } from '../../../../src/main/inventory-snapshot/inventory-report-gate';
import {
  readCtripQuantity,
  readMeituanQuantity,
} from '../../../../src/main/inventory-snapshot/quantity-reading';
import type { SnapshotChange } from '../../../../src/main/inventory-snapshot/snapshot-diff';
import type { JsonObject } from '../../../../src/shared/types/json';
import type { SnapshotCell } from '../../../../src/main/inventory-snapshot/types';

function cell(source: string, itemData: JsonObject, itemType: 'roomStatus' | 'price'): SnapshotCell {
  return {
    source,
    otaHotelId: 'h1',
    otaPhysicalRoomId: source === 'meituan' ? 'r1' : '',
    otaSaleRoomId: source === 'meituan' ? '' : 'r1',
    itemType,
    itemDate: '2026-09-25',
    itemData,
    contentHash: JSON.stringify(itemData),
    observedAt: 1,
    sourceOfTruth: 'scan',
  };
}

function change(
  source: string,
  baseline: JsonObject,
  latest: JsonObject,
  itemType: 'roomStatus' | 'price' = 'roomStatus',
): SnapshotChange {
  return {
    latest: cell(source, latest, itemType),
    baseline: cell(source, baseline, itemType),
  };
}

describe('shouldReport — 美团', () => {
  const reader = readMeituanQuantity;

  // ⭐ 本次收窄要解决的核心噪音。
  it('⭐ 卖出一间（配额未变、未售罄）不上报', () => {
    expect(
      shouldReport(
        change(
          'meituan',
          { roomStatus: 1, invSwitch: 1, limitType: 1, limitRemain: 20, remainCount: 2, usedCount: 0 },
          { roomStatus: 1, invSwitch: 1, limitType: 1, limitRemain: 19, remainCount: 1, usedCount: 1 },
        ),
        reader,
      ),
    ).toBe(false);
  });

  it('⭐ 用户改配额（20 → 25）上报', () => {
    expect(
      shouldReport(
        change(
          'meituan',
          { roomStatus: 1, invSwitch: 1, limitType: 1, limitRemain: 20, usedCount: 0 },
          { roomStatus: 1, invSwitch: 1, limitType: 1, limitRemain: 25, usedCount: 0 },
        ),
        reader,
      ),
    ).toBe(true);
  });

  it('⭐ 最后一间售出（可售非 0 → 0）上报', () => {
    expect(
      shouldReport(
        change(
          'meituan',
          { roomStatus: 1, invSwitch: 1, limitType: 1, limitRemain: 1, usedCount: 9 },
          { roomStatus: 1, invSwitch: 1, limitType: 1, limitRemain: 0, usedCount: 10 },
        ),
        reader,
      ),
    ).toBe(true);
  });

  // ⚠️ 售罄是持续状态，只报跃迁那一轮。
  it('⭐ 已售罄且仍售罄：不重复上报', () => {
    expect(
      shouldReport(
        change(
          'meituan',
          { roomStatus: 1, invSwitch: 1, limitType: 1, limitRemain: 0, usedCount: 10, remainCount: 0 },
          // 同为售罄，只有无关字段变了（才会走到判据）
          { roomStatus: 1, invSwitch: 1, limitType: 1, limitRemain: 0, usedCount: 10, remainCount: 1 },
        ),
        reader,
      ),
    ).toBe(false);
  });

  it('售罄 → 恢复有房 → 再次售罄：第二次仍上报', () => {
    const soldOutAgain = shouldReport(
      change(
        'meituan',
        { roomStatus: 1, invSwitch: 1, limitType: 1, limitRemain: 3, usedCount: 7 },
        { roomStatus: 1, invSwitch: 1, limitType: 1, limitRemain: 0, usedCount: 10 },
      ),
      reader,
    );
    expect(soldOutAgain).toBe(true);
  });

  it('房态变了就报，不看房量', () => {
    expect(
      shouldReport(
        change(
          'meituan',
          { roomStatus: 1, invSwitch: 1, limitType: 1, limitRemain: 5, usedCount: 0 },
          { roomStatus: 0, invSwitch: 0, limitType: 1, limitRemain: 5, usedCount: 0 },
        ),
        reader,
      ),
    ).toBe(true);
  });

  it('invSwitch 单独变化也算房态变化', () => {
    expect(
      shouldReport(
        change(
          'meituan',
          { roomStatus: 1, invSwitch: 1, limitType: 1, limitRemain: 5, usedCount: 0 },
          { roomStatus: 1, invSwitch: 0, limitType: 1, limitRemain: 5, usedCount: 0 },
        ),
        reader,
      ),
    ).toBe(true);
  });

  it('未见过的房态取值（roomStatus=100）照样上报', () => {
    expect(
      shouldReport(
        change(
          'meituan',
          { roomStatus: 1, invSwitch: 1, limitType: 1, limitRemain: 0, usedCount: 10 },
          { roomStatus: 100, invSwitch: 1, limitType: 1, limitRemain: 0, usedCount: 10 },
        ),
        reader,
      ),
    ).toBe(true);
  });

  it('限量 → 不限量的模式切换要上报', () => {
    expect(
      shouldReport(
        change(
          'meituan',
          { roomStatus: 1, invSwitch: 1, limitType: 1, limitRemain: 5, usedCount: 0 },
          { roomStatus: 1, invSwitch: 1, limitType: 2, limitRemain: 1002, usedCount: 0 },
        ),
        reader,
      ),
    ).toBe(true);
  });

  it('字段缺失（算不出配额）时放行上报，不静默漏报', () => {
    expect(
      shouldReport(
        change(
          'meituan',
          { roomStatus: 1, invSwitch: 1, limitType: 1, limitRemain: 5, usedCount: 0 },
          { roomStatus: 1, invSwitch: 1, limitType: 1, remainCount: 3 },
        ),
        reader,
      ),
    ).toBe(true);
  });
});

describe('shouldReport — 携程', () => {
  const reader = readCtripQuantity;

  it('限量房卖出一间（总量未变、未售罄）不上报', () => {
    expect(
      shouldReport(
        change(
          'ctrip',
          { roomStatus: 'G', limitSale: 'T', freeSale: 'F', totalQuantity: 5, canUsedQuantity: 5, hasInventory: true },
          { roomStatus: 'G', limitSale: 'T', freeSale: 'F', totalQuantity: 5, canUsedQuantity: 4, hasInventory: true },
        ),
        reader,
      ),
    ).toBe(false);
  });

  it('总房量变化上报', () => {
    expect(
      shouldReport(
        change(
          'ctrip',
          { roomStatus: 'G', limitSale: 'T', freeSale: 'F', totalQuantity: 5, hasInventory: true },
          { roomStatus: 'G', limitSale: 'T', freeSale: 'F', totalQuantity: 8, hasInventory: true },
        ),
        reader,
      ),
    ).toBe(true);
  });

  it('限量房售罄跃迁上报', () => {
    expect(
      shouldReport(
        change(
          'ctrip',
          { roomStatus: 'G', limitSale: 'T', freeSale: 'F', totalQuantity: 5, canUsedQuantity: 1, hasInventory: true },
          { roomStatus: 'G', limitSale: 'T', freeSale: 'F', totalQuantity: 5, canUsedQuantity: 0, hasInventory: false },
        ),
        reader,
      ),
    ).toBe(true);
  });

  // ⭐ 库里 68 行这种，hasInventory 恒为 false，裸用会全判成售罄。
  it('⭐ 不限量房（freeSale=T、房量恒 0）的房量变化不上报', () => {
    expect(
      shouldReport(
        change(
          'ctrip',
          { roomStatus: 'G', limitSale: 'F', freeSale: 'T', totalQuantity: 0, canUsedQuantity: 0, hasInventory: false },
          { roomStatus: 'G', limitSale: 'F', freeSale: 'T', totalQuantity: 0, canUsedQuantity: 5, hasInventory: false },
        ),
        reader,
      ),
    ).toBe(false);
  });

  // ⚠️ 实测有 7 个房型出现过模式切换 —— 这是经营动作，不能漏。
  it('⭐ 不限量 → 限量的模式切换要上报', () => {
    expect(
      shouldReport(
        change(
          'ctrip',
          { roomStatus: 'G', limitSale: 'F', freeSale: 'T', totalQuantity: 0, hasInventory: false },
          { roomStatus: 'G', limitSale: 'T', freeSale: 'F', totalQuantity: 5, hasInventory: true },
        ),
        reader,
      ),
    ).toBe(true);
  });

  it('房态变了就报', () => {
    expect(
      shouldReport(
        change(
          'ctrip',
          { roomStatus: 'G', limitSale: 'T', freeSale: 'F', totalQuantity: 5, hasInventory: true },
          { roomStatus: 'N', limitSale: 'T', freeSale: 'F', totalQuantity: 5, hasInventory: true },
        ),
        reader,
      ),
    ).toBe(true);
  });
});

describe('shouldReport — 通用', () => {
  it('价格格子维持「变了就报」', () => {
    expect(
      shouldReport(change('ctrip', { price: 100 }, { price: 120 }, 'price'), readCtripQuantity),
    ).toBe(true);
  });

  // ⚠️ 没登记口径的渠道不能静默漏报 —— 回到旧行为。
  it('渠道没登记房量口径时放行上报', () => {
    expect(
      shouldReport(change('douyin', { roomStatus: 1 }, { roomStatus: 1, foo: 2 }), undefined),
    ).toBe(true);
  });
});
