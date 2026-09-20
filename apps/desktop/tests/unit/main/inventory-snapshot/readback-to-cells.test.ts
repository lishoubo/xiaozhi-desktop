import { describe, expect, it, vi } from 'vitest';
import {
  createPageReadSnapshotPersister,
  createReadbackSnapshotPersister,
  masterHotelIdOf,
  readbackCellsOf,
} from '../../../../src/main/inventory-snapshot/readback-to-cells';
import { extractCtripSnapshotCells } from '../../../../src/main/inventory-snapshot/ctrip-cells';
import type { SnapshotCell } from '../../../../src/main/inventory-snapshot/types';
import type { OtaAmountChangeObserved } from '../../../../src/shared/types/amount-change';
import { toChannelId } from '../../../../src/main/ids';
import type { JsonObject } from '../../../../src/shared/types/json';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function readbackReport(cells: JsonObject[]): OtaAmountChangeObserved {
  return {
    source: toChannelId('ctrip'),
    changeType: 'inventoryReadback',
    endpointId: 'getRoomInventoryInfo',
    endpointUrl: 'https://ebooking.ctrip.com/x',
    otaHotelId: '',
    changeRaw: { trigger: {}, probedAt: 'x', truncated: false, cells },
  };
}

const ROW: JsonObject = {
  hotelID: 115348672,
  roomTypeID: 1569052069,
  effectDate: '2026-10-20',
  roomStatus: 'G',
  limitSale: 'T',
  totalQuantity: 6,
  canUsedQuantity: 6,
};

/** 用真实的携程 mapper，避免测一个假的形状。 */
const ctripMapper = (
  rows: readonly JsonObject[],
  hotelId: string,
  truth: Parameters<typeof extractCtripSnapshotCells>[2],
  at: number,
) => extractCtripSnapshotCells({ roomStatusResult: rows }, hotelId, truth, at);

function create(
  credentialExtra: JsonObject | null,
  logger = createLogger(),
): { persist: ReturnType<typeof createReadbackSnapshotPersister>; enqueued: SnapshotCell[][]; logger: ReturnType<typeof createLogger> } {
  const enqueued: SnapshotCell[][] = [];
  const persist = createReadbackSnapshotPersister({
    mappers: new Map([['ctrip', ctripMapper]]),
    credentialExtraByPartition: () => credentialExtra,
    enqueue: (cells) => void enqueued.push([...cells]),
    logger,
    now: () => 1700,
  });
  return { persist, enqueued, logger };
}

describe('masterHotelIdOf', () => {
  it('接受数字与非空字符串', () => {
    expect(masterHotelIdOf({ masterHotelId: 85068938 })).toBe('85068938');
    expect(masterHotelIdOf({ masterHotelId: ' 85068938 ' })).toBe('85068938');
  });

  it('缺失、空串、null、非有限数一律返回 null', () => {
    expect(masterHotelIdOf(null)).toBeNull();
    expect(masterHotelIdOf({})).toBeNull();
    expect(masterHotelIdOf({ masterHotelId: '' })).toBeNull();
    expect(masterHotelIdOf({ masterHotelId: '   ' })).toBeNull();
    expect(masterHotelIdOf({ masterHotelId: null })).toBeNull();
    expect(masterHotelIdOf({ masterHotelId: Number.NaN })).toBeNull();
  });
});

describe('readbackCellsOf', () => {
  it('取出 cells 数组', () => {
    expect(readbackCellsOf(readbackReport([ROW]))).toEqual([ROW]);
  });

  it('cells 缺失或不是数组时返回空', () => {
    const report = { ...readbackReport([]), changeRaw: {} };
    expect(readbackCellsOf(report)).toEqual([]);
  });

  it('过滤掉非对象元素', () => {
    const report = readbackReport([]);
    const mixed = { ...report, changeRaw: { cells: [ROW, null, 'x', 1, [ROW]] } };
    expect(readbackCellsOf(mixed as OtaAmountChangeObserved)).toEqual([ROW]);
  });
});

describe('createReadbackSnapshotPersister', () => {
  it('用凭证的 masterHotelId 归一，不用报文里的 hotelID', () => {
    const { persist, enqueued } = create({ masterHotelId: 85068938 });

    persist(readbackReport([ROW]), 'persist:ota-1');

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.[0]?.otaHotelId).toBe('85068938');
    // 报文里那个是「门店 × 售卖模式」层的 ID，绝不能当成酒店标识。
    expect(enqueued[0]?.[0]?.otaHotelId).not.toBe('115348672');
  });

  // ⚠️ 与既有上报刻意不同：那边回退原值，这里拒绝整批。存错会永久污染基线。
  it('拿不到 masterHotelId 时拒绝整批并告警', () => {
    const { persist, enqueued, logger } = create({});

    persist(readbackReport([ROW]), 'persist:ota-1');

    expect(enqueued).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      'Snapshot skipped: credential has no masterHotelId',
      expect.objectContaining({ droppedRows: 1 }),
    );
  });

  it('未注册 mapper 的渠道直接跳过，不告警', () => {
    const { persist, enqueued, logger } = create({ masterHotelId: 1 });
    const meituan = { ...readbackReport([ROW]), source: toChannelId('meituan') };

    persist(meituan as OtaAmountChangeObserved, 'persist:ota-1');

    expect(enqueued).toHaveLength(0);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('cells 为空时不投递', () => {
    const { persist, enqueued } = create({ masterHotelId: 1 });
    persist(readbackReport([]), 'persist:ota-1');
    expect(enqueued).toHaveLength(0);
  });

  it('标记来源为 readback', () => {
    const { persist, enqueued } = create({ masterHotelId: 1 });
    persist(readbackReport([ROW]), 'persist:ota-1');
    expect(enqueued[0]?.[0]?.sourceOfTruth).toBe('readback');
    expect(enqueued[0]?.[0]?.observedAt).toBe(1700);
  });
});

describe('createPageReadSnapshotPersister', () => {
  function createPageRead(credentialExtra: JsonObject | null, logger = createLogger()) {
    const enqueued: SnapshotCell[][] = [];
    const persist = createPageReadSnapshotPersister({
      mappers: new Map([['ctrip', ctripMapper]]),
      credentialExtraByPartition: () => credentialExtra,
      enqueue: (cells) => void enqueued.push([...cells]),
      logger,
      now: () => 2600,
    });
    return { persist, enqueued, logger };
  }

  it('用凭证归一并标记来源为 page-read', () => {
    const { persist, enqueued } = createPageRead({ masterHotelId: 85068938 });

    persist('ctrip', 'getRoomInventoryInfo:read', [ROW], 'persist:ota-1');

    expect(enqueued[0]?.[0]).toMatchObject({
      otaHotelId: '85068938',
      sourceOfTruth: 'page-read',
      observedAt: 2600,
    });
  });

  it('拿不到 masterHotelId 时拒绝整批并告警', () => {
    const { persist, enqueued, logger } = createPageRead(null);

    persist('ctrip', 'getRoomInventoryInfo:read', [ROW], 'persist:ota-1');

    expect(enqueued).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      'Snapshot skipped: credential has no masterHotelId',
      expect.objectContaining({ droppedRows: 1 }),
    );
  });

  it('未注册 mapper 的渠道与空行都不投递', () => {
    const { persist, enqueued } = createPageRead({ masterHotelId: 1 });

    persist('meituan', 'x', [ROW], 'persist:ota-1');
    persist('ctrip', 'x', [], 'persist:ota-1');

    expect(enqueued).toHaveLength(0);
  });
});
