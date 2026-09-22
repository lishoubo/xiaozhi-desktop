import { describe, expect, it } from 'vitest';
import {
  mapMeituanReadRows,
  meituanContentHash,
  MEITUAN_SNAPSHOT_KIND_MARKER,
  MEITUAN_SOURCE,
} from '../../../src/main/inventory-snapshot/meituan-cells';
import { MEITUAN_SCAN_KIND_MARKER } from '../../../src/main/channels/meituan/inventory-scan';
import type { SnapshotCellMapper } from '../../../src/main/inventory-snapshot/types';
import { snapshotKeyOf } from '../../../src/main/inventory-snapshot/types';
import { flattenRoomStatusRows } from '../../../src/main/channels/meituan/room-status-endpoint';
import type { JsonObject } from '../../../src/shared/types/json';
import fixture from '../../fixtures/meituan/query-room-status-info.json';

const HOTEL = '1834077877';
const AT = 1_700_000_000_000;

function statusRow(extra: JsonObject = {}): JsonObject {
  return {
    [MEITUAN_SCAN_KIND_MARKER]: 'roomStatus',
    roomId: 354223342,
    roomName: '云享三人间',
    roomCategory: 1,
    containerId: 372062584,
    date: '2026-09-21',
    roomStatus: 1,
    limitType: 1,
    remainCount: 1,
    limitRemain: 5,
    usedCount: 0,
    invSwitch: 1,
    ...extra,
  };
}

function priceRow(extra: JsonObject = {}): JsonObject {
  return {
    [MEITUAN_SCAN_KIND_MARKER]: 'price',
    goodsId: 847226645,
    goodsName: '大床房-不含早',
    date: '2026-09-21',
    salePrice: '20700',
    basePrice: '18009',
    originPrice: '0',
    subPrice: '2691',
    subRatio: 1300,
    ...extra,
  };
}

function map(rows: JsonObject[], dates?: ReadonlySet<string>) {
  return mapMeituanReadRows(rows, HOTEL, 'scan', AT, dates);
}

describe('mapMeituanReadRows', () => {
  // ⭐ 美团与携程最大的差异：两类格子落在不同的房型 ID 空间。
  it('房态行记在物理房型上，售卖房型留空', () => {
    const [cell] = map([statusRow()]);

    expect(cell).toMatchObject({
      source: MEITUAN_SOURCE,
      otaHotelId: HOTEL,
      otaPhysicalRoomId: '354223342',
      otaSaleRoomId: '',
      itemType: 'roomStatus',
      itemDate: '2026-09-21',
      sourceOfTruth: 'scan',
      observedAt: AT,
    });
  });

  it('价格行记在售卖房型上，物理房型留空 —— 与房态刚好相反', () => {
    const [cell] = map([priceRow()]);

    expect(cell).toMatchObject({
      otaPhysicalRoomId: '',
      otaSaleRoomId: '847226645',
      itemType: 'price',
      itemDate: '2026-09-21',
    });
  });

  // 同一物理房型下多个售卖商品：价格各自独立成格，房态只有一格。
  it('一个物理房型下多个商品，价格多格、房态一格', () => {
    const cells = map([
      statusRow(),
      priceRow({ goodsId: 1 }),
      priceRow({ goodsId: 2 }),
      priceRow({ goodsId: 3 }),
    ]);

    expect(cells.filter((cell) => cell.itemType === 'roomStatus')).toHaveLength(1);
    expect(cells.filter((cell) => cell.itemType === 'price')).toHaveLength(3);
  });

  // ⚠️ 两类格子的键必须不同，否则会互相覆盖。
  it('同一天的房态格与价格格不撞键', () => {
    const [status, price] = map([statusRow(), priceRow()]);

    expect(snapshotKeyOf(status!)).not.toBe(snapshotKeyOf(price!));
  });

  it('剥掉分流标记后才存进 itemData', () => {
    const [cell] = map([statusRow()]);

    expect(cell!.itemData).not.toHaveProperty(MEITUAN_SNAPSHOT_KIND_MARKER);
    expect(cell!.itemData).toMatchObject({ roomStatus: 1, limitRemain: 5 });
  });

  // itemData 宽（整行便于排查），contentHash 窄（只取事实字段）。
  it('itemData 整行原样，包括不参与 hash 的字段', () => {
    const [cell] = map([statusRow()]);

    expect(cell!.itemData).toHaveProperty('containerId', 372062584);
    expect(cell!.itemData).toHaveProperty('roomName', '云享三人间');
  });

  // ⚠️ 金额是「分」的字符串，转换等于在客户端复刻渠道语义。
  it('金额原样透传，不转单位也不转类型', () => {
    const [cell] = map([priceRow()]);

    expect(cell!.itemData).toMatchObject({ salePrice: '20700', basePrice: '18009' });
  });

  it('取不到房型 ID 的行被跳过', () => {
    expect(map([statusRow({ roomId: null })])).toEqual([]);
    expect(map([priceRow({ goodsId: '' })])).toEqual([]);
  });

  it('取不到日期的行被跳过', () => {
    expect(map([statusRow({ date: '' })])).toEqual([]);
    expect(map([priceRow({ date: 20260921 })])).toEqual([]);
  });

  // 扫描不传 dates（要整个窗口），自然读回读那条路可能传。
  it('给定 dates 时只保留命中的日期', () => {
    const rows = [statusRow({ date: '2026-09-21' }), statusRow({ date: '2026-09-22' })];

    expect(map(rows, new Set(['2026-09-22']))).toHaveLength(1);
    expect(map(rows)).toHaveLength(2);
  });

  // 标记缺失是打标记那侧的疏漏，按更基础的那类兜底。
  it('未带标记的行按房态处理', () => {
    const row = statusRow();
    delete (row as Record<string, unknown>)[MEITUAN_SCAN_KIND_MARKER];

    expect(map([row])[0]).toMatchObject({ itemType: 'roomStatus' });
  });

  it('符合 SnapshotCellMapper 的形状', () => {
    const mapper: SnapshotCellMapper = mapMeituanReadRows;

    expect(mapper([statusRow()], HOTEL, 'page-read', AT)).toHaveLength(1);
  });
});

describe('contentHash', () => {
  // ⚠️ 两组字段必须分开：混用会让两类格子的 hash 都恒为全 ~，任何变化都测不出。
  it('房态与价格用各自的字段集，互不为空', () => {
    const [status] = map([statusRow()]);
    const [price] = map([priceRow()]);

    expect(status!.contentHash).not.toMatch(/^[~|]+$/);
    expect(price!.contentHash).not.toMatch(/^[~|]+$/);
  });

  it('事实字段变化时 hash 变化', () => {
    const before = map([statusRow()])[0]!.contentHash;

    expect(map([statusRow({ roomStatus: 0 })])[0]!.contentHash).not.toBe(before);
    expect(map([statusRow({ limitRemain: 6 })])[0]!.contentHash).not.toBe(before);
    expect(map([statusRow({ usedCount: 2 })])[0]!.contentHash).not.toBe(before);
    expect(map([statusRow({ invSwitch: 0 })])[0]!.contentHash).not.toBe(before);
  });

  // ⚠️ 渠道内部字段变化不该被判成价量态变更，否则扫描反复误报。
  it('渠道内部字段与展示字段变化时 hash 不变', () => {
    const before = map([statusRow()])[0]!.contentHash;

    expect(map([statusRow({ containerId: 999 })])[0]!.contentHash).toBe(before);
    expect(map([statusRow({ shareType: 9 })])[0]!.contentHash).toBe(before);
    expect(map([statusRow({ roomName: '改了名字' })])[0]!.contentHash).toBe(before);
  });

  // ⭐ `remainCount` 是**预留房量**，与配额（limitRemain + usedCount）无算术关系。
  // 留在指纹里的唯一效果是制造噪音：它一抖动格子就判成 changed，而上报判据只看
  // 配额变化与售罄跃迁 → 又被滤掉，白比对一场。真机 2026-09-22 实测过两次。
  it('⭐ remainCount（预留房量）不参与 hash', () => {
    const before = map([statusRow()])[0]!.contentHash;

    expect(map([statusRow({ remainCount: 0 })])[0]!.contentHash).toBe(before);
    expect(map([statusRow({ remainCount: 7 })])[0]!.contentHash).toBe(before);
  });

  // ⚠️ 少了 usedCount，「卖出一间的同时配额加一间」（limitRemain 不变、usedCount +1）
  // 这种变化就测不出来 —— 它和 limitRemain 必须成对参与。
  it('usedCount 必须参与 —— 单独变化也要测得出来', () => {
    const before = map([statusRow({ limitRemain: 5, usedCount: 0 })])[0]!.contentHash;

    expect(map([statusRow({ limitRemain: 5, usedCount: 1 })])[0]!.contentHash).not.toBe(before);
  });

  it('价格事实字段变化时 hash 变化', () => {
    const before = map([priceRow()])[0]!.contentHash;

    expect(map([priceRow({ salePrice: '19900' })])[0]!.contentHash).not.toBe(before);
    expect(map([priceRow({ basePrice: '17000' })])[0]!.contentHash).not.toBe(before);
    expect(map([priceRow({ subRatio: 1000 })])[0]!.contentHash).not.toBe(before);
  });

  // subPrice = salePrice × subRatio，参与进来等于把同一事实数两遍。
  it('subPrice 不参与价格 hash', () => {
    const before = map([priceRow()])[0]!.contentHash;

    expect(map([priceRow({ subPrice: '9999' })])[0]!.contentHash).toBe(before);
  });

  // 缺失与显式 null 都记成 ~，与字符串 "null" 区分。
  it('缺失与 null 同样记法，且与字符串 null 不同', () => {
    expect(meituanContentHash({}, ['a'])).toBe('~');
    expect(meituanContentHash({ a: null }, ['a'])).toBe('~');
    expect(meituanContentHash({ a: 'null' }, ['a'])).not.toBe('~');
  });

  it('按给定顺序拼接，顺序不同则 hash 不同', () => {
    const row = { a: 1, b: 2 };

    expect(meituanContentHash(row, ['a', 'b'])).toBe('1|2');
    expect(meituanContentHash(row, ['b', 'a'])).toBe('2|1');
  });
});

/**
 * 用**真实踩点响应**走一遍「展平 → 映射」，确认两层对接得上。
 *
 * 手写的 fixture 只能验我以为的字段名；这份是真机抓的，能挡住「字段名记错」这类错误。
 */
describe('真实 fixture 端到端', () => {
  it('queryRoomStatusInfo 的真实响应能映射成格子', () => {
    const { rows } = flattenRoomStatusRows(fixture.data);
    const cells = mapMeituanReadRows(
      rows.map((row) => ({ ...row, [MEITUAN_SCAN_KIND_MARKER]: 'roomStatus' })),
      HOTEL,
      'scan',
      AT,
    );

    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(cell.itemType).toBe('roomStatus');
      // 房态记在物理房型上
      expect(cell.otaPhysicalRoomId).not.toBe('');
      expect(cell.otaSaleRoomId).toBe('');
      // ⚠️ hash 不能恒为全 ~ —— 那说明字段名对不上，任何变化都测不出
      expect(cell.contentHash).not.toMatch(/^[~|]+$/);
    }
  });

  // 同一 roomId 的钟点房那一行在展平层就被挡掉，格子不会撞键。
  it('真实响应里的格子键互不重复', () => {
    const { rows } = flattenRoomStatusRows(fixture.data);
    const cells = mapMeituanReadRows(rows, HOTEL, 'scan', AT);
    const keys = cells.map(snapshotKeyOf);

    expect(new Set(keys).size).toBe(keys.length);
  });
});

/**
 * ⚠️ 跨模块断言：两处常量必须逐字符相同。
 *
 * eslint 禁止 `channels/` 依赖 `inventory-snapshot/`，所以标记在两边各写一份字面量。
 * 不一致时映射侧会把所有行都当成房态，**价格格子静默消失**，日志上看不出任何异常 ——
 * 这条测试是唯一的保障。
 */
describe('分流标记跨模块一致', () => {
  it('渠道侧与映射侧的标记相同', () => {
    expect(MEITUAN_SCAN_KIND_MARKER).toBe(MEITUAN_SNAPSHOT_KIND_MARKER);
  });

  it('标记不一致时价格格子会被错认成房态 —— 说明这条断言为什么必要', () => {
    // 模拟渠道侧改了标记名而映射侧没跟：价格行带着另一个键进来
    const drifted: JsonObject = { ...priceRow(), __snapshotKindV2: 'price' };
    delete (drifted as Record<string, unknown>)[MEITUAN_SCAN_KIND_MARKER];

    // 它被当成房态处理，而房态取的是 roomId —— 取不到，整行静默丢失
    expect(map([drifted])).toEqual([]);
  });
});
