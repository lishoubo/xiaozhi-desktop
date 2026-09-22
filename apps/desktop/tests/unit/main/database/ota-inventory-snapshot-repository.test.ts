import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  openApplicationDatabase,
  type ApplicationDatabase,
} from '../../../../src/main/database/application-database';
import { SqliteOtaInventorySnapshotRepository } from '../../../../src/main/database/ota-inventory-snapshot-repository';
import type { SnapshotCell } from '../../../../src/main/inventory-snapshot/types';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function cell(overrides: Partial<SnapshotCell> = {}): SnapshotCell {
  return {
    source: 'ctrip',
    otaHotelId: '122247738',
    otaPhysicalRoomId: '',
    otaSaleRoomId: '1569052069',
    itemType: 'roomStatus',
    itemDate: '2026-10-20',
    itemData: { roomStatus: 'G', totalQuantity: 6 },
    contentHash: 'hash-1',
    observedAt: 1_700_000_000_000,
    sourceOfTruth: 'readback',
    ...overrides,
  };
}

function countRows(database: ApplicationDatabase): number {
  return (
    database
      .prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM ota_inventory_snapshot')
      .get()?.n ?? -1
  );
}

let database: ApplicationDatabase;
let repository: SqliteOtaInventorySnapshotRepository;

beforeEach(() => {
  database = openApplicationDatabase(':memory:', createLogger());
  repository = new SqliteOtaInventorySnapshotRepository(database);
});

describe('迁移', () => {
  it('建表后可立即写入（v9 随既有迁移链一起应用）', () => {
    expect(repository.upsertMany([cell()])).toBe(1);
    expect(countRows(database)).toBe(1);
  });
});

describe('房型名', () => {
  it('写入后能读回来', () => {
    repository.upsertMany([cell({ roomName: '云享三人间' })]);
    const [stored] = repository.findByHotelAndDateRange(
      'ctrip',
      '122247738',
      '2026-10-20',
      '2026-10-20',
    );
    expect(stored?.roomName).toBe('云享三人间');
  });

  // ⚠️ 老记录没有名字（migration 10 之前写的），读取方必须容忍。
  it('没有名字时读回 undefined，不是空串', () => {
    repository.upsertMany([cell()]);
    const [stored] = repository.findByHotelAndDateRange(
      'ctrip',
      '122247738',
      '2026-10-20',
      '2026-10-20',
    );
    expect(stored?.roomName).toBeUndefined();
  });

  it('重写同一格时名字跟着更新 —— 谁写的就是谁的名字', () => {
    repository.upsertMany([cell({ roomName: '旧名' })]);
    repository.upsertMany([cell({ roomName: '新名' })]);
    const [stored] = repository.findByHotelAndDateRange(
      'ctrip',
      '122247738',
      '2026-10-20',
      '2026-10-20',
    );
    expect(stored?.roomName).toBe('新名');
  });

  // 名字不在格子键里 —— 改名不该产生一行新记录。
  it('名字不同不产生新行', () => {
    repository.upsertMany([cell({ roomName: '旧名' })]);
    repository.upsertMany([cell({ roomName: '新名' })]);
    expect(countRows(database)).toBe(1);
  });
});

describe('upsertMany', () => {
  it('同一格重复写入是覆盖，不新增行', () => {
    repository.upsertMany([cell({ contentHash: 'old', itemData: { roomStatus: 'G' } })]);
    repository.upsertMany([cell({ contentHash: 'new', itemData: { roomStatus: 'N' } })]);

    expect(countRows(database)).toBe(1);
    const [stored] = repository.findByHotelAndDateRange(
      'ctrip',
      '122247738',
      '2026-10-01',
      '2026-10-31',
    );
    expect(stored?.contentHash).toBe('new');
    expect(stored?.itemData).toEqual({ roomStatus: 'N' });
  });

  it('房型 ID 的两个维度参与唯一键：物理与售卖不同的格子互不覆盖', () => {
    repository.upsertMany([
      cell({ otaSaleRoomId: 'sale-1', otaPhysicalRoomId: '' }),
      cell({ otaSaleRoomId: '', otaPhysicalRoomId: 'phys-1' }),
    ]);
    expect(countRows(database)).toBe(2);
  });

  it('item_type 参与唯一键：同房型同日的房态与价格各占一格', () => {
    repository.upsertMany([cell({ itemType: 'roomStatus' }), cell({ itemType: 'price' })]);
    expect(countRows(database)).toBe(2);
  });

  // ⚠️ 这条是空值用 '' 不用 NULL 的理由：若这一列可空，NULL != NULL 会让每次写入都
  // INSERT 新行而不是 upsert，同一格反复累积。
  it('空的房型 ID 维度仍能 upsert，不会因空值每次新增行', () => {
    repository.upsertMany([cell({ otaPhysicalRoomId: '' })]);
    repository.upsertMany([cell({ otaPhysicalRoomId: '' })]);
    expect(countRows(database)).toBe(1);
  });

  it('两个房型 ID 都为空的格子被跳过，且不影响同批其余格子', () => {
    const written = repository.upsertMany([
      cell({ otaSaleRoomId: '', otaPhysicalRoomId: '' }),
      cell({ otaSaleRoomId: 'sale-ok' }),
    ]);
    expect(written).toBe(1);
    expect(countRows(database)).toBe(1);
  });

  it('空数组不写入也不抛错', () => {
    expect(repository.upsertMany([])).toBe(0);
  });

  it('itemData 原样存取，不做语义转换', () => {
    // 渠道枚举必须原样保留 —— "G"/"N" 不转开关，"T"/"F" 不转布尔。
    const raw = { roomStatus: 'G', limitSale: 'T', freeSale: 'F', canUsedQuantity: 7 };
    repository.upsertMany([cell({ itemData: raw })]);
    const [stored] = repository.findByHotelAndDateRange(
      'ctrip',
      '122247738',
      '2026-10-20',
      '2026-10-20',
    );
    expect(stored?.itemData).toEqual(raw);
  });
});

describe('findByHotelAndDateRange', () => {
  beforeEach(() => {
    repository.upsertMany([
      cell({ itemDate: '2026-10-19', otaSaleRoomId: 'r1' }),
      cell({ itemDate: '2026-10-20', otaSaleRoomId: 'r1' }),
      cell({ itemDate: '2026-10-21', otaSaleRoomId: 'r1' }),
    ]);
  });

  it('日期区间是闭区间，含两端', () => {
    const found = repository.findByHotelAndDateRange(
      'ctrip',
      '122247738',
      '2026-10-19',
      '2026-10-21',
    );
    expect(found.map((c) => c.itemDate)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21']);
  });

  it('区间外的格子不返回', () => {
    const found = repository.findByHotelAndDateRange(
      'ctrip',
      '122247738',
      '2026-10-20',
      '2026-10-20',
    );
    expect(found.map((c) => c.itemDate)).toEqual(['2026-10-20']);
  });

  it('按渠道与酒店隔离', () => {
    repository.upsertMany([cell({ source: 'meituan', otaPhysicalRoomId: 'm1', otaSaleRoomId: '' })]);
    repository.upsertMany([cell({ otaHotelId: 'other-hotel' })]);

    const found = repository.findByHotelAndDateRange(
      'ctrip',
      '122247738',
      '2026-10-01',
      '2026-10-31',
    );
    expect(found.every((c) => c.source === 'ctrip' && c.otaHotelId === '122247738')).toBe(true);
  });
});

describe('deleteOlderThan', () => {
  it('只删早于给定日期的格子', () => {
    repository.upsertMany([
      cell({ itemDate: '2026-10-18', otaSaleRoomId: 'r1' }),
      cell({ itemDate: '2026-10-20', otaSaleRoomId: 'r1' }),
    ]);
    expect(repository.deleteOlderThan('2026-10-20', 100)).toBe(1);
    expect(countRows(database)).toBe(1);
  });

  // ⚠️ limit 是防「积压久了一次无界 DELETE 卡住主进程」的，必须真的生效 ——
  // 子查询写错（比如 LIMIT 落在外层）会让它静默失效，行为上看不出来。
  it('一次最多删 limit 行，剩下的留给下一批', () => {
    repository.upsertMany([
      cell({ itemDate: '2026-10-10', otaSaleRoomId: 'r1' }),
      cell({ itemDate: '2026-10-11', otaSaleRoomId: 'r2' }),
      cell({ itemDate: '2026-10-12', otaSaleRoomId: 'r3' }),
    ]);
    expect(repository.deleteOlderThan('2026-10-20', 2)).toBe(2);
    expect(countRows(database)).toBe(1);
    expect(repository.deleteOlderThan('2026-10-20', 2)).toBe(1);
    expect(countRows(database)).toBe(0);
  });
});
