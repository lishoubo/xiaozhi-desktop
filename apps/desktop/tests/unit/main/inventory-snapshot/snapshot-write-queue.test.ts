import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SnapshotWriteQueue } from '../../../../src/main/inventory-snapshot/snapshot-write-queue';
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
    itemData: { roomStatus: 'G' },
    contentHash: 'hash-1',
    observedAt: 1,
    sourceOfTruth: 'readback',
    ...overrides,
  };
}

/** 同步驱动 drain，免去等定时器 —— 队列本身不关心用什么方式让出。 */
function createQueue(
  write: (cells: readonly SnapshotCell[]) => number,
  overrides: { batchSize?: number; maxPending?: number } = {},
) {
  const logger = createLogger();
  const queue = new SnapshotWriteQueue({
    write,
    logger,
    scheduleDrain: (run) => run(),
    ...overrides,
  });
  return { queue, logger };
}

let written: SnapshotCell[][];

beforeEach(() => {
  written = [];
});

const record = (cells: readonly SnapshotCell[]): number => {
  written.push([...cells]);
  return cells.length;
};

describe('投递', () => {
  it('push 同步返回，不等写入结果', () => {
    const { queue } = createQueue(record);
    expect(queue.push([cell()])).toBeUndefined();
    expect(written).toHaveLength(1);
  });

  it('空数组不触发写入', () => {
    const { queue } = createQueue(record);
    queue.push([]);
    expect(written).toHaveLength(0);
  });
});

describe('去重合并', () => {
  it('同一格重复投递只写最新一份', () => {
    // 队列不立即 drain 时才能观察到合并 —— 用手动调度攒住。
    const scheduled: (() => void)[] = [];
    const logger = createLogger();
    const queue = new SnapshotWriteQueue({
      write: record,
      logger,
      scheduleDrain: (run) => void scheduled.push(run),
    });

    queue.push([cell({ contentHash: 'old' })]);
    queue.push([cell({ contentHash: 'new' })]);
    expect(queue.pendingCount).toBe(1);

    scheduled.shift()?.();
    expect(written).toEqual([[expect.objectContaining({ contentHash: 'new' })]]);
  });

  it('不同格子各自保留', () => {
    const { queue } = createQueue(record);
    queue.push([cell({ itemDate: '2026-10-20' }), cell({ itemDate: '2026-10-21' })]);
    expect(written[0]).toHaveLength(2);
  });

  it('item_type 不同视为不同格', () => {
    const { queue } = createQueue(record);
    queue.push([cell({ itemType: 'roomStatus' }), cell({ itemType: 'price' })]);
    expect(written[0]).toHaveLength(2);
  });
});

describe('写失败隔离', () => {
  it('写入抛错不冒泡给投递方', () => {
    const { queue, logger } = createQueue(() => {
      throw new Error('disk full');
    });
    expect(() => queue.push([cell()])).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      'Snapshot cells flush failed, dropping batch',
      expect.objectContaining({ droppedRows: 1 }),
    );
  });

  it('一批失败后队列仍可继续工作', () => {
    let shouldFail = true;
    const { queue } = createQueue((cells) => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error('transient');
      }
      return record(cells);
    });

    queue.push([cell({ itemDate: '2026-10-20' })]);
    queue.push([cell({ itemDate: '2026-10-21' })]);
    expect(written).toHaveLength(1);
  });
});

describe('分批让出', () => {
  it('超过 batchSize 时分多批写，每批之间让出', () => {
    const { queue } = createQueue(record, { batchSize: 2 });
    queue.push([
      cell({ itemDate: '2026-10-20' }),
      cell({ itemDate: '2026-10-21' }),
      cell({ itemDate: '2026-10-22' }),
    ]);
    expect(written.map((b) => b.length)).toEqual([2, 1]);
  });
});

describe('溢出保护', () => {
  it('超过 maxPending 时丢弃最早的并告警', () => {
    const scheduled: (() => void)[] = [];
    const logger = createLogger();
    const queue = new SnapshotWriteQueue({
      write: record,
      logger,
      maxPending: 2,
      scheduleDrain: (run) => void scheduled.push(run),
    });

    queue.push([
      cell({ itemDate: '2026-10-20' }),
      cell({ itemDate: '2026-10-21' }),
      cell({ itemDate: '2026-10-22' }),
    ]);

    expect(queue.pendingCount).toBe(2);
    expect(logger.warn).toHaveBeenCalledWith(
      'Snapshot write queue overflowed, dropped oldest cells',
      expect.objectContaining({ dropped: 1 }),
    );
    scheduled.shift()?.();
    // 最早的 10-20 被丢掉。
    expect(written[0]?.map((c) => c.itemDate)).toEqual(['2026-10-21', '2026-10-22']);
  });

  // ⚠️ 回归：Map 对已存在的 key 做 set 会保持原插入位置，重新投递的格子若不移到队尾，
  // 会带着**最新值**排在队首被当成「最早的」丢掉 —— 与溢出淘汰的意图正好相反。
  it('重新投递的格子移到队尾，淘汰时不会丢掉它的最新值', () => {
    const scheduled: (() => void)[] = [];
    const logger = createLogger();
    const queue = new SnapshotWriteQueue({
      write: record,
      logger,
      maxPending: 2,
      scheduleDrain: (run) => void scheduled.push(run),
    });

    queue.push([cell({ itemDate: '2026-10-20', contentHash: 'v1' })]);
    queue.push([cell({ itemDate: '2026-10-21' })]);
    // 10-20 被重新投递，带上新值 —— 它现在是队列里最新的那一格。
    queue.push([cell({ itemDate: '2026-10-20', contentHash: 'v2' })]);
    // 触发溢出：应淘汰 10-21（最久没被投递过的），而不是刚更新的 10-20。
    queue.push([cell({ itemDate: '2026-10-22' })]);

    scheduled.shift()?.();
    const flushed = written[0] ?? [];
    expect(flushed.map((c) => c.itemDate)).toEqual(['2026-10-20', '2026-10-22']);
    expect(flushed.find((c) => c.itemDate === '2026-10-20')?.contentHash).toBe('v2');
  });
});

describe('耗时日志', () => {
  it('成功写入时记录行数与耗时（判断是否搬 worker 的依据）', () => {
    const { queue, logger } = createQueue(record);
    queue.push([cell()]);
    expect(logger.info).toHaveBeenCalledWith(
      'Snapshot cells flushed',
      expect.objectContaining({ flushedRows: 1, flushMs: expect.any(Number) }),
    );
  });
});

describe('dispose', () => {
  it('释放后不再接受投递', () => {
    const { queue } = createQueue(record);
    queue.dispose();
    queue.push([cell()]);
    expect(written).toHaveLength(0);
  });

  it('释放会丢弃未写入项', () => {
    const logger = createLogger();
    const queue = new SnapshotWriteQueue({
      write: record,
      logger,
      scheduleDrain: () => {},
    });
    queue.push([cell()]);
    expect(queue.pendingCount).toBe(1);
    queue.dispose();
    expect(queue.pendingCount).toBe(0);
  });
});
