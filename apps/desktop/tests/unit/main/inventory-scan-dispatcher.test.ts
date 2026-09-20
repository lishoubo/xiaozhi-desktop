import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InventoryScanDispatcher,
  type InventoryScanDispatcherDependencies,
  type ScanRuntimeConfig,
  type ScanTarget,
} from '../../../src/main/channels/inventory-scan-dispatcher';
import type { InventoryScan, InventoryScanOutcome } from '../../../src/main/channels/types';
import { toChannelId } from '../../../src/main/ids';
import type { JsonObject } from '../../../src/shared/types/json';

const CTRIP = toChannelId('ctrip');
const ROW: JsonObject = { roomTypeID: 1, effectDate: '2026-10-20' };

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function target(overrides: Partial<ScanTarget> = {}): ScanTarget {
  return { channel: CTRIP, partitionName: 'persist:ctrip:a', otaHotelId: '122244992', ...overrides };
}

function config(overrides: Partial<ScanRuntimeConfig> = {}): ScanRuntimeConfig {
  return {
    enabled: true,
    idleMs: 300_000,
    jitterMs: 60_000,
    windowDays: 15,
    quietAfterWriteMs: 0,
    isChannelEnabled: () => true,
    isHotelEnabled: () => true,
    ...overrides,
  };
}

function scanOf(outcome: InventoryScanOutcome | (() => Promise<InventoryScanOutcome>)): {
  scan: InventoryScan;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    scan: {
      scan: async (partitionName) => {
        calls.push(partitionName);
        return typeof outcome === 'function' ? outcome() : outcome;
      },
    },
  };
}

/** 手动驱动定时器 —— 不等真实时间。 */
function createHarness(overrides: Partial<InventoryScanDispatcherDependencies> = {}) {
  const scheduled: { run: () => void; delayMs: number }[] = [];
  const logger = createLogger();
  const onRows = vi.fn();
  const reportError = vi.fn();
  const cleared: NodeJS.Timeout[] = [];

  const deps: InventoryScanDispatcherDependencies = {
    scans: new Map([[CTRIP, scanOf({ kind: 'ok', rows: [ROW] }).scan]]),
    logger,
    config: () => config(),
    listTargets: () => [target()],
    onRows,
    lastWriteAt: () => null,
    reportError,
    setTimer: (run, delayMs) => {
      scheduled.push({ run, delayMs });
      return scheduled.length as unknown as NodeJS.Timeout;
    },
    clearTimer: (timer) => void cleared.push(timer),
    random: () => 0,
    ...overrides,
  };

  const dispatcher = new InventoryScanDispatcher(deps);
  /** 触发最早一个待跑的定时回调。 */
  const fire = async (): Promise<void> => {
    const next = scheduled.shift();
    next?.run();
    await new Promise((resolve) => setImmediate(resolve));
  };
  return { dispatcher, scheduled, fire, logger, onRows, reportError, cleared };
}

let harness: ReturnType<typeof createHarness>;

beforeEach(() => {
  harness = createHarness();
});

describe('调度形状', () => {
  // ⚠️ 首轮也等一个间隔：启动期要跑迁移、登录、凭证发现，不与它们抢。
  it('start 不立刻扫，先排一个定时', () => {
    harness.dispatcher.start();
    expect(harness.onRows).not.toHaveBeenCalled();
    expect(harness.scheduled).toHaveLength(1);
  });

  it('跑完一轮后自动排下一轮', async () => {
    harness.dispatcher.start();
    await harness.fire();
    expect(harness.onRows).toHaveBeenCalledTimes(1);
    expect(harness.scheduled).toHaveLength(1);
  });

  // ⚠️ fixed-delay 的核心：上一轮没跑完，不会有第二轮并发。
  it('上一轮未结束时不排下一轮', async () => {
    // 用数组收集 resolver：直接赋给 let 变量时 TS 会把它窄化成 never。
    const releases: (() => void)[] = [];
    const slow = scanOf(
      () =>
        new Promise<InventoryScanOutcome>((resolve) => {
          releases.push(() => resolve({ kind: 'ok', rows: [] }));
        }),
    );
    const h = createHarness({ scans: new Map([[CTRIP, slow.scan]]) });
    h.dispatcher.start();
    await h.fire();

    // 本轮卡在 scan 里，此刻不该有新的定时被排上。
    expect(h.scheduled).toHaveLength(0);
    releases[0]?.();
    // 让 scan 的 promise 链一路 settle 到 finally 里的 scheduleNext。
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.scheduled).toHaveLength(1);
  });

  it('单轮抛错仍排下一轮，循环不断', async () => {
    const h = createHarness({
      listTargets: () => {
        throw new Error('db gone');
      },
    });
    h.dispatcher.start();
    await h.fire();
    expect(h.logger.warn).toHaveBeenCalledWith(
      'Inventory scan round threw',
      expect.anything(),
    );
    expect(h.scheduled).toHaveLength(1);
  });

  it('dispose 后不再跑也不再排', async () => {
    harness.dispatcher.start();
    harness.dispatcher.dispose();
    expect(harness.cleared).toHaveLength(1);
    await harness.fire();
    expect(harness.onRows).not.toHaveBeenCalled();
    expect(harness.scheduled).toHaveLength(0);
  });
});

describe('抖动', () => {
  // ⚠️ 没有抖动，集中部署的门店会长期同相位，每 idleMs 齐刷刷打一次渠道。
  it('random 为 0 时恰好是 idleMs', () => {
    const h = createHarness({ random: () => 0 });
    h.dispatcher.start();
    expect(h.scheduled[0]?.delayMs).toBe(300_000);
  });

  it('random 接近 1 时接近上界，但不超过', () => {
    const h = createHarness({ random: () => 0.999999 });
    h.dispatcher.start();
    const delay = h.scheduled[0]?.delayMs ?? 0;
    expect(delay).toBeGreaterThan(300_000);
    expect(delay).toBeLessThan(360_000);
  });

  it('jitterMs 为 0 时退化成固定间隔', () => {
    const h = createHarness({ config: () => config({ jitterMs: 0 }), random: () => 0.9 });
    h.dispatcher.start();
    expect(h.scheduled[0]?.delayMs).toBe(300_000);
  });

  // ⚠️ 每轮重新读配置：构造时取一次会让服务端下发要等重启才生效。
  it('间隔每轮重新读配置', async () => {
    let idleMs = 300_000;
    const h = createHarness({ config: () => config({ idleMs }) });
    h.dispatcher.start();
    expect(h.scheduled[0]?.delayMs).toBe(300_000);
    idleMs = 60_000;
    await h.fire();
    expect(h.scheduled[0]?.delayMs).toBe(60_000);
  });
});

describe('开关', () => {
  it('总闸关闭时整轮跳过，不遍历账号，并记 info', async () => {
    const listTargets = vi.fn(() => [target()]);
    const h = createHarness({ config: () => config({ enabled: false }), listTargets });
    h.dispatcher.start();
    await h.fire();
    expect(listTargets).not.toHaveBeenCalled();
    // ⚠️ 整轮跳过必须记日志，否则与「调度器挂了」分不清。
    expect(h.logger.info).toHaveBeenCalledWith('Inventory scan skipped: disabled');
  });

  it('渠道关闭时该渠道不扫', async () => {
    const h = createHarness({ config: () => config({ isChannelEnabled: () => false }) });
    h.dispatcher.start();
    await h.fire();
    expect(h.onRows).not.toHaveBeenCalled();
  });

  it('酒店关闭时该店不扫，同渠道其余店照常', async () => {
    const h = createHarness({
      listTargets: () => [target({ otaHotelId: 'off' }), target({ otaHotelId: 'on' })],
      config: () => config({ isHotelEnabled: (_c, id) => id === 'on' }),
    });
    h.dispatcher.start();
    await h.fire();
    expect(h.onRows).toHaveBeenCalledTimes(1);
    expect(h.onRows.mock.calls[0]?.[0]).toMatchObject({ otaHotelId: 'on' });
  });

  it('未注册扫描能力的渠道直接跳过', async () => {
    const h = createHarness({ scans: new Map() });
    h.dispatcher.start();
    await h.fire();
    expect(h.onRows).not.toHaveBeenCalled();
  });
});

describe('静默窗口', () => {
  it('距上次写操作不足阈值时跳过本轮', async () => {
    const h = createHarness({
      config: () => config({ quietAfterWriteMs: 60_000 }),
      lastWriteAt: () => 1_000_000,
      now: () => 1_030_000,
    });
    h.dispatcher.start();
    await h.fire();
    expect(h.onRows).not.toHaveBeenCalled();
    expect(h.logger.info).toHaveBeenCalledWith('Inventory scan skipped: recent user write');
  });

  it('超过阈值后照常扫', async () => {
    const h = createHarness({
      config: () => config({ quietAfterWriteMs: 60_000 }),
      lastWriteAt: () => 1_000_000,
      now: () => 1_200_000,
    });
    h.dispatcher.start();
    await h.fire();
    expect(h.onRows).toHaveBeenCalledTimes(1);
  });

  it('从未写过时不跳过', async () => {
    const h = createHarness({
      config: () => config({ quietAfterWriteMs: 60_000 }),
      lastWriteAt: () => null,
    });
    h.dispatcher.start();
    await h.fire();
    expect(h.onRows).toHaveBeenCalledTimes(1);
  });
});

describe('逐账号处置', () => {
  it('ok 时把行递出去，带上 target', async () => {
    harness.dispatcher.start();
    await harness.fire();
    expect(harness.onRows).toHaveBeenCalledWith(
      expect.objectContaining({ otaHotelId: '122244992' }),
      [ROW],
    );
  });

  // ⚠️ 空结果是合法的 —— 调度层不替上层判断「确实没数据」怎么处理。
  it('ok 且空行也照常递出', async () => {
    const h = createHarness({ scans: new Map([[CTRIP, scanOf({ kind: 'ok', rows: [] }).scan]]) });
    h.dispatcher.start();
    await h.fire();
    expect(h.onRows).toHaveBeenCalledWith(expect.anything(), []);
  });

  it('skipped 记 info，不递行、不上报错误', async () => {
    const h = createHarness({
      scans: new Map([[CTRIP, scanOf({ kind: 'skipped', reason: 'no-rooms' }).scan]]),
    });
    h.dispatcher.start();
    await h.fire();
    expect(h.onRows).not.toHaveBeenCalled();
    expect(h.reportError).not.toHaveBeenCalled();
  });

  it('failed 记 warn 并上报 GlitchTip', async () => {
    const h = createHarness({
      scans: new Map([[CTRIP, scanOf({ kind: 'failed', reason: 'COOKIE_EXPIRED' }).scan]]),
    });
    h.dispatcher.start();
    await h.fire();
    expect(h.logger.warn).toHaveBeenCalledWith(
      'Inventory scan failed',
      expect.objectContaining({ reason: 'COOKIE_EXPIRED' }),
    );
    expect(h.reportError).toHaveBeenCalled();
  });

  // ⚠️ 一个账号失效不该影响同轮其余账号 —— 这是多店部署的基本要求。
  it('一个账号失败不影响其余账号', async () => {
    let call = 0;
    const flaky: InventoryScan = {
      scan: async () => {
        call += 1;
        if (call === 1) return { kind: 'failed', reason: 'COOKIE_EXPIRED' };
        return { kind: 'ok', rows: [ROW] };
      },
    };
    const h = createHarness({
      scans: new Map([[CTRIP, flaky]]),
      listTargets: () => [target({ otaHotelId: 'bad' }), target({ otaHotelId: 'good' })],
    });
    h.dispatcher.start();
    await h.fire();
    expect(h.onRows).toHaveBeenCalledTimes(1);
    expect(h.onRows.mock.calls[0]?.[0]).toMatchObject({ otaHotelId: 'good' });
  });

  it('渠道实现抛错被兜住，同轮其余账号照常', async () => {
    let call = 0;
    const throwing: InventoryScan = {
      scan: async () => {
        call += 1;
        if (call === 1) throw new Error('boom');
        return { kind: 'ok', rows: [ROW] };
      },
    };
    const h = createHarness({
      scans: new Map([[CTRIP, throwing]]),
      listTargets: () => [target({ otaHotelId: 'bad' }), target({ otaHotelId: 'good' })],
    });
    h.dispatcher.start();
    await h.fire();
    expect(h.logger.warn).toHaveBeenCalledWith('Inventory scan threw', expect.anything());
    expect(h.onRows).toHaveBeenCalledTimes(1);
  });
});
