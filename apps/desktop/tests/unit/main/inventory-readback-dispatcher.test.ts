import { describe, expect, it, vi } from 'vitest';
import { InventoryReadbackDispatcher } from '../../../src/main/channels/inventory-readback-dispatcher';
import type { InventoryReadback, ReadbackOutcome } from '../../../src/main/channels/types';
import { toChannelId } from '../../../src/main/ids';
import type { OtaAmountChangeObserved } from '../../../src/shared/types/amount-change';
import type { WebContents } from 'electron';

const CTRIP = toChannelId('ctrip');
const FAKE_WC = {} as WebContents;
const PARTITION = 'persist:ota-1';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function reportOf(source = CTRIP): OtaAmountChangeObserved {
  return {
    source,
    changeType: 'roomStatus',
    endpointId: 'batchUpdateRoomStatusAndQuantity',
    endpointUrl: 'https://ebooking.ctrip.com/x',
    otaHotelId: '',
    changeRaw: {},
  };
}

const READBACK_REPORT: OtaAmountChangeObserved = {
  ...reportOf(),
  changeType: 'inventoryReadback',
  endpointId: 'getRoomInventoryInfo',
};

function readbackOf(outcome: ReadbackOutcome | (() => Promise<ReadbackOutcome>)): {
  readback: InventoryReadback;
  calls: number[];
} {
  const calls: number[] = [];
  return {
    calls,
    readback: {
      readback: async () => {
        calls.push(1);
        return typeof outcome === 'function' ? outcome() : outcome;
      },
    },
  };
}

function create(readbacks: ReadonlyMap<string, InventoryReadback>, logger = createLogger()) {
  const report = vi.fn();
  const dispatcher = new InventoryReadbackDispatcher({
    readbacks: readbacks as ReadonlyMap<ReturnType<typeof toChannelId>, InventoryReadback>,
    logger,
    report,
  });
  return { dispatcher, report, logger };
}

describe('InventoryReadbackDispatcher', () => {
  it('ok 时把回读结果递出去', async () => {
    const { readback } = readbackOf({ kind: 'ok', report: READBACK_REPORT });
    const { dispatcher, report } = create(new Map([[CTRIP, readback]]));

    await dispatcher.onReported(reportOf(), FAKE_WC, PARTITION);

    expect(report).toHaveBeenCalledWith(READBACK_REPORT, PARTITION);
  });

  it('skipped 时不上报，且记 info 而非 warn', async () => {
    const { readback } = readbackOf({ kind: 'skipped', reason: 'not-a-room-inventory-endpoint' });
    const { dispatcher, report, logger } = create(new Map([[CTRIP, readback]]));

    await dispatcher.onReported(reportOf(), FAKE_WC, PARTITION);

    expect(report).not.toHaveBeenCalled();
    // ⚠️「不需要读」与「读失败了」必须在日志里分得开 —— 否则排查时看不出是逻辑挡掉的
    // 还是真出错了。
    expect(logger.info).toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('failed 时不上报，记 warn', async () => {
    const { readback } = readbackOf({ kind: 'failed', reason: 'COOKIE_EXPIRED' });
    const { dispatcher, report, logger } = create(new Map([[CTRIP, readback]]));

    await dispatcher.onReported(reportOf(), FAKE_WC, PARTITION);

    expect(report).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('未注册回读能力的渠道直接跳过，不调用也不记噪音日志', async () => {
    const { readback, calls } = readbackOf({ kind: 'ok', report: READBACK_REPORT });
    // 注册的是携程，来的是美团。
    const { dispatcher, report, logger } = create(new Map([[CTRIP, readback]]));

    await dispatcher.onReported(reportOf(toChannelId('meituan')), FAKE_WC, PARTITION);

    expect(calls).toHaveLength(0);
    expect(report).not.toHaveBeenCalled();
    // 每次改价都会走到这里，记日志会变成噪音。
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  /**
   * ⭐ 守 design 决策 1.1：机制层**不认识任何渠道**。
   *
   * 用一个真实注册表里不存在的渠道注册回读实现 —— 若 dispatcher 里写了
   * `if (source === 'ctrip')` 之类的硬编码，这条就会红。只测携程通过是看不出来的。
   */
  it('对任意注册了回读能力的渠道一视同仁（证明无渠道硬编码）', async () => {
    const fakeChannel = toChannelId('douyin'); // 真实注册表里刻意不注册回读的渠道
    const { readback, calls } = readbackOf({ kind: 'ok', report: READBACK_REPORT });
    const { dispatcher, report } = create(new Map([[fakeChannel, readback]]));

    await dispatcher.onReported(reportOf(fakeChannel), FAKE_WC, PARTITION);

    expect(calls).toHaveLength(1);
    expect(report).toHaveBeenCalledWith(READBACK_REPORT, PARTITION);
  });

  it('渠道实现抛异常时吞掉并记 warn，不冒泡', async () => {
    const readback: InventoryReadback = {
      readback: async () => {
        throw new Error('boom');
      },
    };
    const { dispatcher, report, logger } = create(new Map([[CTRIP, readback]]));

    await expect(dispatcher.onReported(reportOf(), FAKE_WC, PARTITION)).resolves.toBeUndefined();

    expect(report).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('dispose 后不再发起回读', async () => {
    const { readback, calls } = readbackOf({ kind: 'ok', report: READBACK_REPORT });
    const { dispatcher, report } = create(new Map([[CTRIP, readback]]));

    dispatcher.dispose();
    await dispatcher.onReported(reportOf(), FAKE_WC, PARTITION);

    expect(calls).toHaveLength(0);
    expect(report).not.toHaveBeenCalled();
  });

  it('dispose 期间返回的 in-flight 结果被丢弃，不投递给已拆掉的 scope', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { readback } = readbackOf(async () => {
      await gate;
      return { kind: 'ok', report: READBACK_REPORT } as ReadbackOutcome;
    });
    const { dispatcher, report } = create(new Map([[CTRIP, readback]]));

    const pending = dispatcher.onReported(reportOf(), FAKE_WC, PARTITION);
    dispatcher.dispose(); // 回读还在飞的时候窗口被关
    release();
    await pending;

    expect(report).not.toHaveBeenCalled();
  });
});
