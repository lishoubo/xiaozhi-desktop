import { describe, expect, it, vi } from 'vitest';
import {
  SnapshotCleaner,
  type SnapshotCleanupRuntimeConfig,
} from '../../../../src/main/inventory-snapshot/snapshot-cleaner';
import type { AppLogger } from '../../../../src/shared/logging';

function createLogger(): AppLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as AppLogger;
}

const CONFIG: SnapshotCleanupRuntimeConfig = {
  retentionDays: 3,
  batchSize: 2,
  idleMs: 6 * 60 * 60_000,
};

/**
 * 同步驱动的测试床。
 *
 * `scheduleBatch` / `setTimer` 都收成待执行队列，由用例显式 `runPending()` 推进 ——
 * 这正是这两个依赖被设计成入参的理由（见 snapshot-cleaner.ts）。
 */
function createHarness(
  options: Partial<{
    config: SnapshotCleanupRuntimeConfig;
    deleteOlderThan: (beforeDate: string, limit: number) => number;
  }> = {},
) {
  const batches: (() => void)[] = [];
  const timers: { run: () => void; delayMs: number }[] = [];
  const logger = createLogger();
  const deleteCalls: { beforeDate: string; limit: number }[] = [];

  const deleteOlderThan =
    options.deleteOlderThan ??
    (() => {
      return 0;
    });

  const cleaner = new SnapshotCleaner({
    deleteOlderThan: (beforeDate, limit) => {
      deleteCalls.push({ beforeDate, limit });
      return deleteOlderThan(beforeDate, limit);
    },
    logger,
    config: () => options.config ?? CONFIG,
    scheduleBatch: (run) => batches.push(run),
    setTimer: (run, delayMs) => {
      timers.push({ run, delayMs });
      return timers.length as unknown as NodeJS.Timeout;
    },
    clearTimer: () => {},
    now: () => new Date('2026-09-21T10:00:00'),
  });

  /** 跑完所有已排队的批次（每跑一个可能再排下一个）。 */
  const drainBatches = (): void => {
    let guard = 0;
    while (batches.length > 0) {
      if (++guard > 1000) throw new Error('batches did not settle');
      batches.shift()?.();
    }
  };

  /** 触发最近排上的定时器（即「跑一轮」）。 */
  const fireTimer = (): void => {
    const timer = timers.shift();
    if (!timer) throw new Error('no timer scheduled');
    timer.run();
    drainBatches();
  };

  return { cleaner, timers, logger, deleteCalls, fireTimer };
}

describe('SnapshotCleaner', () => {
  it('start 只排定时器，不立刻删 —— 启动路径上一行库都不碰', () => {
    // ⚠️ 这条守的是本次改动的起因：原实现同步跑在 createAppScope 里，卡多久窗口就晚多久。
    const { cleaner, deleteCalls, timers } = createHarness();

    cleaner.start(30_000);

    expect(deleteCalls).toHaveLength(0);
    expect(timers[0]?.delayMs).toBe(30_000);
  });

  it('cutoff 是「今天减保留天数」的本地日历日', () => {
    // ⚠️ 必须与 item_date 同为本地日历日：用 UTC 算会在时区偏移下差一天，
    // 表现为今天的格子被当成过期删掉。
    const { cleaner, deleteCalls, fireTimer } = createHarness();

    cleaner.start(0);
    fireTimer();

    expect(deleteCalls[0]?.beforeDate).toBe('2026-09-18');
  });

  it('删满一批就继续删下一批，每批之间让出事件循环', () => {
    let remaining = 5;
    const { cleaner, deleteCalls, fireTimer } = createHarness({
      deleteOlderThan: (_beforeDate, limit) => {
        const deleted = Math.min(limit, remaining);
        remaining -= deleted;
        return deleted;
      },
    });

    cleaner.start(0);
    fireTimer();

    // batchSize 2，共 5 行：2 + 2 + 1，最后一批没删满即停。
    expect(deleteCalls.map((call) => call.limit)).toEqual([2, 2, 2]);
    expect(remaining).toBe(0);
  });

  it('没删满一批说明已清干净，不再多查一次', () => {
    const { cleaner, deleteCalls, fireTimer } = createHarness({
      deleteOlderThan: () => 1, // batchSize 是 2，首批就没删满
    });

    cleaner.start(0);
    fireTimer();

    expect(deleteCalls).toHaveLength(1);
  });

  it('一轮结束后按 idleMs 排下一轮（fixed-delay）', () => {
    const { cleaner, timers, fireTimer } = createHarness();

    cleaner.start(0);
    fireTimer();

    expect(timers[0]?.delayMs).toBe(CONFIG.idleMs);
  });

  it('idleMs 被配得过小时钳到下限，不变成忙循环', () => {
    // 配置每轮重读且设计上可由服务端下发，所以钳制必须在消费侧。
    const { cleaner, timers, fireTimer } = createHarness({
      config: { ...CONFIG, idleMs: 100 },
    });

    cleaner.start(0);
    fireTimer();

    expect(timers[0]?.delayMs).toBe(60_000);
  });

  it('删除抛错时吞掉并记 warn，仍排下一轮', () => {
    // ⚠️ 清理失败不该挡住任何东西 —— 库里多留些旧行只是占空间，不影响正确性。
    const { cleaner, logger, timers, fireTimer } = createHarness({
      deleteOlderThan: () => {
        throw new Error('database is locked');
      },
    });

    cleaner.start(0);
    expect(() => fireTimer()).not.toThrow();

    expect(logger.warn).toHaveBeenCalledWith(
      'Inventory snapshot purge failed',
      expect.objectContaining({ cutoff: '2026-09-18' }),
    );
    expect(timers[0]?.delayMs).toBe(CONFIG.idleMs);
  });

  it('单轮有批次上限，配置把保留期设成 0 天也不会一直删下去', () => {
    // 防的是配置事故：那时几乎整张表都过期，没有上限这一轮会霸占事件循环很久。
    const { cleaner, deleteCalls, fireTimer } = createHarness({
      config: { ...CONFIG, retentionDays: 0 },
      deleteOlderThan: (_beforeDate, limit) => limit, // 永远删得满，模拟删不完
    });

    cleaner.start(0);
    fireTimer();

    expect(deleteCalls).toHaveLength(50);
  });

  it('dispose 之后 start 不再排定时器', () => {
    const { cleaner, timers } = createHarness();

    cleaner.dispose();
    cleaner.start(0);

    expect(timers).toHaveLength(0);
  });

  it('一轮跑到一半被 dispose 时立刻停，不再删也不再排下一轮', () => {
    // ⚠️ 退出流程里 dispose 与正在进行的分批清理是并存的：批次之间会让出事件循环，
    // 正好是 dispose 插进来的窗口。漏判会让进程退出时还在删库。
    const { cleaner, deleteCalls, timers, fireTimer } = createHarness({
      deleteOlderThan: (_beforeDate, limit) => {
        cleaner.dispose(); // 第一批删完就 dispose
        return limit; // 删满了，正常情况下会继续下一批
      },
    });

    cleaner.start(0);
    fireTimer();

    expect(deleteCalls).toHaveLength(1);
    expect(timers).toHaveLength(0);
  });
});
