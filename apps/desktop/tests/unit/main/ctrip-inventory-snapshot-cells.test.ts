import { describe, expect, it } from 'vitest';
import {
  ctripContentHash,
  extractCtripSnapshotCells,
  mapCtripReadRows,
} from '../../../src/main/inventory-snapshot/ctrip-cells';
import type { JsonObject } from '../../../src/shared/types/json';

/** 去掉一个字段，返回可变副本 —— `JsonObject` 是 readonly，不能直接 delete。 */
function omit(source: JsonObject, field: string): Record<string, JsonObject[string]> {
  const copy: Record<string, JsonObject[string]> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key !== field) copy[key] = value;
  }
  return copy;
}

/** 与 `ctrip-inventory-readback.test.ts` 同一份真实样本形状。 */
function row(roomTypeID: number, effectDate: string, extra: JsonObject = {}): JsonObject {
  return {
    hotelID: 122247738,
    roomTypeID,
    effectDate,
    payType: 'PP',
    roomStatus: 'G',
    limitSale: 'T',
    freeSale: 'F',
    totalQuantity: 6,
    canUsedQuantity: 6,
    hasInventory: true,
    ...extra,
  };
}

const response = (rows: JsonObject[]): JsonObject => ({ roomStatusResult: rows });

describe('extractCtripSnapshotCells', () => {
  it('抽出格子并填好键', () => {
    const cells = extractCtripSnapshotCells(
      response([row(1569052069, '2026-10-20')]),
      '122247738',
      'readback',
      1700,
    );
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({
      source: 'ctrip',
      otaHotelId: '122247738',
      otaSaleRoomId: '1569052069',
      otaPhysicalRoomId: '',
      itemType: 'roomStatus',
      itemDate: '2026-10-20',
      sourceOfTruth: 'readback',
      observedAt: 1700,
    });
  });

  // ⚠️ 这条守住「不转换渠道枚举」：转了就是在客户端复刻携程语义。
  it('itemData 是整行原样，枚举不转换', () => {
    const raw = row(1, '2026-10-20', { roomStatus: 'Y', limitSale: 'F', freeSale: 'T' });
    const [cell] = extractCtripSnapshotCells(response([raw]), 'h', 'page-read', 1);
    expect(cell?.itemData).toEqual(raw);
    expect(cell?.itemData.roomStatus).toBe('Y');
    expect(cell?.itemData.freeSale).toBe('T');
  });

  // ⚠️ 这条守住「otaHotelId 取凭证不取响应」—— 响应里的 hotelID 是门店×售卖模式层。
  it('otaHotelId 用入参，不用响应里的 hotelID', () => {
    const [cell] = extractCtripSnapshotCells(
      response([row(1, '2026-10-20', { hotelID: 999999 })]),
      'master-123',
      'readback',
      1,
    );
    expect(cell?.otaHotelId).toBe('master-123');
    // 原值仍保留在 itemData 里供排查。
    expect(cell?.itemData.hotelID).toBe(999999);
  });

  it('给定日期集合时只保留集合内的行', () => {
    const cells = extractCtripSnapshotCells(
      response([row(1, '2026-10-20'), row(1, '2026-10-21'), row(1, '2026-10-22')]),
      'h',
      'readback',
      1,
      new Set(['2026-10-20', '2026-10-22']),
    );
    expect(cells.map((c) => c.itemDate)).toEqual(['2026-10-20', '2026-10-22']);
  });

  it('不给日期集合时全收（自然读：用户翻到什么存什么）', () => {
    const cells = extractCtripSnapshotCells(
      response([row(1, '2026-10-20'), row(1, '2026-10-21')]),
      'h',
      'page-read',
      1,
    );
    expect(cells).toHaveLength(2);
  });

  it('缺 roomTypeID 的行被跳过，不落定位不了的脏数据', () => {
    const bad = { ...row(1, '2026-10-20') };
    delete bad.roomTypeID;
    const cells = extractCtripSnapshotCells(
      response([bad, row(2, '2026-10-20')]),
      'h',
      'readback',
      1,
    );
    expect(cells.map((c) => c.otaSaleRoomId)).toEqual(['2']);
  });

  it('缺 effectDate 的行被跳过', () => {
    const bad = { ...row(1, '2026-10-20') };
    delete bad.effectDate;
    expect(extractCtripSnapshotCells(response([bad]), 'h', 'readback', 1)).toHaveLength(0);
  });

  it('响应形状不对时返回空数组，不抛错', () => {
    expect(extractCtripSnapshotCells(null, 'h', 'readback', 1)).toHaveLength(0);
    expect(extractCtripSnapshotCells({}, 'h', 'readback', 1)).toHaveLength(0);
    expect(extractCtripSnapshotCells({ roomStatusResult: 'nope' }, 'h', 'readback', 1)).toHaveLength(
      0,
    );
    expect(extractCtripSnapshotCells([], 'h', 'readback', 1)).toHaveLength(0);
  });
});

describe('ctripContentHash', () => {
  it('同内容不同键序算出同一 hash', () => {
    const a = { roomStatus: 'G', limitSale: 'T', totalQuantity: 6 };
    const b = { totalQuantity: 6, limitSale: 'T', roomStatus: 'G' };
    expect(ctripContentHash(a)).toBe(ctripContentHash(b));
  });

  it('房态变化会改变 hash', () => {
    expect(ctripContentHash(row(1, 'd'))).not.toBe(
      ctripContentHash(row(1, 'd', { roomStatus: 'N' })),
    );
  });

  it('房量变化会改变 hash', () => {
    expect(ctripContentHash(row(1, 'd'))).not.toBe(
      ctripContentHash(row(1, 'd', { canUsedQuantity: 0 })),
    );
  });

  it('限量标记变化会改变 hash', () => {
    expect(ctripContentHash(row(1, 'd'))).not.toBe(
      ctripContentHash(row(1, 'd', { limitSale: 'F' })),
    );
  });

  // ⚠️ 这条是 contentHash 取窄字段集的理由：响应里的门店层字段变了不代表房态变了。
  it('hotelID 与 payType 变化不影响 hash', () => {
    expect(ctripContentHash(row(1, 'd'))).toBe(
      ctripContentHash(row(1, 'd', { hotelID: 999, payType: 'FG' })),
    );
  });

  it('字段缺失与显式 null 算出同一 hash', () => {
    const missing = { roomStatus: 'G' };
    const explicitNull = { roomStatus: 'G', totalQuantity: null };
    expect(ctripContentHash(missing)).toBe(ctripContentHash(explicitNull));
  });
});

describe('mapCtripReadRows（房态 + 价格两类格子）', () => {
  const statusRow = (extra: JsonObject = {}): JsonObject => ({
    ...row(1569052069, '2026-10-20'),
    __snapshotKind: 'roomStatus',
    ...extra,
  });
  const priceRow = (extra: JsonObject = {}): JsonObject => ({
    roomTypeID: 1569052069,
    effectDate: '2026-10-20',
    price: 328,
    originalPrice: 321,
    currency: 'CNY',
    __snapshotKind: 'price',
    ...extra,
  });

  it('房态行与价格行各自成格，item_type 不同', () => {
    const cells = mapCtripReadRows([statusRow(), priceRow()], 'h', 'page-read', 1);
    expect(cells.map((c) => c.itemType)).toEqual(['roomStatus', 'price']);
  });

  // ⚠️ 同房型同日的房态与价格是**两格**，靠 item_type 区分，不会互相覆盖。
  it('同房型同日期的两类格子键不冲突', () => {
    const cells = mapCtripReadRows([statusRow(), priceRow()], 'h', 'page-read', 1);
    expect(cells[0]?.otaSaleRoomId).toBe(cells[1]?.otaSaleRoomId);
    expect(cells[0]?.itemDate).toBe(cells[1]?.itemDate);
    expect(cells[0]?.itemType).not.toBe(cells[1]?.itemType);
  });

  // ⚠️ 标记是我们加的，不是携程字段 —— 存进基线会混入渠道没有的字段。
  it('分流标记被剥掉，不进 itemData', () => {
    const cells = mapCtripReadRows([statusRow(), priceRow()], 'h', 'page-read', 1);
    expect(cells[0]?.itemData).not.toHaveProperty('__snapshotKind');
    expect(cells[1]?.itemData).not.toHaveProperty('__snapshotKind');
  });

  // ⚠️ 价格用独立的 hash 字段集：套房态那组会让所有价格格子的 hash 恒为全 '~'，
  // 于是改价测不出来。
  it('价格变化会改变价格格子的 hash', () => {
    const a = mapCtripReadRows([priceRow({ price: 328 })], 'h', 'page-read', 1);
    const b = mapCtripReadRows([priceRow({ price: 400 })], 'h', 'page-read', 1);
    expect(a[0]?.contentHash).not.toBe(b[0]?.contentHash);
    expect(a[0]?.contentHash).not.toBe('~|~');
  });

  it('originalPrice 变化不影响 hash —— 它不是实际售价', () => {
    const a = mapCtripReadRows([priceRow({ originalPrice: 321 })], 'h', 'page-read', 1);
    const b = mapCtripReadRows([priceRow({ originalPrice: 999 })], 'h', 'page-read', 1);
    expect(a[0]?.contentHash).toBe(b[0]?.contentHash);
  });

  it('价格行用 date 字段时同样认', () => {
    const r = omit(priceRow(), 'effectDate');
    r.date = '2026-10-21';
    expect(mapCtripReadRows([r], 'h', 'page-read', 1)[0]?.itemDate).toBe('2026-10-21');
  });

  it('无标记的行按房态处理（回读路径的 cells 就是这样）', () => {
    const cells = mapCtripReadRows([row(1, '2026-10-20')], 'h', 'readback', 1);
    expect(cells[0]?.itemType).toBe('roomStatus');
  });

  it('缺房型或日期的行被跳过，不影响同批其余行', () => {
    const bad = omit(priceRow(), 'roomTypeID');
    const cells = mapCtripReadRows([bad, statusRow()], 'h', 'page-read', 1);
    expect(cells).toHaveLength(1);
    expect(cells[0]?.itemType).toBe('roomStatus');
  });
});
