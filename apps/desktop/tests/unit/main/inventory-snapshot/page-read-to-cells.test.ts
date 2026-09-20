import { describe, expect, it, vi } from 'vitest';
import {
  createPageReadSnapshotPersister,
  masterHotelIdOf,
} from '../../../../src/main/inventory-snapshot/page-read-to-cells';
import { extractCtripSnapshotCells } from '../../../../src/main/inventory-snapshot/ctrip-cells';
import type { SnapshotCell } from '../../../../src/main/inventory-snapshot/types';
import type { JsonObject } from '../../../../src/shared/types/json';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
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
