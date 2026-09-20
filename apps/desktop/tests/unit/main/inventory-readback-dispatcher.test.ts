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
  const reportError = vi.fn();
  const dispatcher = new InventoryReadbackDispatcher({
    readbacks: readbacks as ReadonlyMap<ReturnType<typeof toChannelId>, InventoryReadback>,
    logger,
    report,
    reportError,
  });
  return { dispatcher, report, logger, reportError };
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
    // 原意是「失败不能只记 info」。链路起点的 starting 是 info，但它不描述结果 ——
    // 断言收紧到「没有任何 info 声称这次成功/跳过」，比「一条 info 都没有」更贴原意。
    const infoMessages = logger.info.mock.calls.map(([message]) => message);
    expect(infoMessages).not.toContain('Inventory readback ok');
    expect(infoMessages).not.toContain('Inventory readback skipped');
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

  /**
   * 回读是**后台链路**：用户看不见，失败也不影响他手上的操作。只在本地日志里留痕的话
   * 没人会知道，所以 failed / threw 必须同时进 GlitchTip。
   *
   * ⚠️ 但 skipped / ok 绝不能报 —— skipped 是逻辑挡掉（不是房量端点、只改了钟点房、
   * 日期为空），属正常流程，报上去会用噪音淹没真问题。
   */
  describe('错误上报', () => {
    it('failed 时先 warn 再 report，带上渠道与门店', async () => {
      const { readback } = readbackOf({ kind: 'failed', reason: 'COOKIE_EXPIRED' });
      const { dispatcher, logger, reportError } = create(new Map([[CTRIP, readback]]));

      await dispatcher.onReported(
        { ...reportOf(), otaHotelId: 'hotel-9' },
        FAKE_WC,
        PARTITION,
      );

      // 两者都要，不是二选一
      expect(logger.warn).toHaveBeenCalled();
      expect(reportError).toHaveBeenCalledTimes(1);
      const [error, context] = reportError.mock.calls[0];
      expect((error as Error).message).toContain('COOKIE_EXPIRED');
      expect(context).toMatchObject({
        operation: 'inventoryReadback',
        channel: 'ctrip',
        hotelId: 'hotel-9',
        extra: { reason: 'COOKIE_EXPIRED' },
      });
    });

    it('渠道实现自己抛异常时也上报，reason 标成 threw', async () => {
      const readback: InventoryReadback = {
        readback: async () => {
          throw new Error('boom');
        },
      };
      const { dispatcher, reportError } = create(new Map([[CTRIP, readback]]));

      await dispatcher.onReported(reportOf(), FAKE_WC, PARTITION);

      expect(reportError).toHaveBeenCalledTimes(1);
      const [error, context] = reportError.mock.calls[0];
      expect((error as Error).message).toBe('boom');
      expect(context).toMatchObject({ extra: { reason: 'threw' } });
    });

    it('⚠️ skipped 不上报 —— 那是正常流程，报了会淹没真问题', async () => {
      const { readback } = readbackOf({ kind: 'skipped', reason: 'no-targets' });
      const { dispatcher, reportError, logger } = create(new Map([[CTRIP, readback]]));

      await dispatcher.onReported(reportOf(), FAKE_WC, PARTITION);

      expect(logger.info).toHaveBeenCalled();
      expect(reportError).not.toHaveBeenCalled();
    });

    it('ok 不上报', async () => {
      const { readback } = readbackOf({ kind: 'ok', report: READBACK_REPORT });
      const { dispatcher, reportError } = create(new Map([[CTRIP, readback]]));

      await dispatcher.onReported(reportOf(), FAKE_WC, PARTITION);

      expect(reportError).not.toHaveBeenCalled();
    });

    it('otaHotelId 为空串时不传 hotelId（而非传空串）', async () => {
      const { readback } = readbackOf({ kind: 'failed', reason: 'NETWORK_ERROR' });
      const { dispatcher, reportError } = create(new Map([[CTRIP, readback]]));

      await dispatcher.onReported(reportOf(), FAKE_WC, PARTITION);

      expect(reportError.mock.calls[0][1].hotelId).toBeUndefined();
    });

    it('未注入 reportError 时不炸（可选依赖走 noop）', async () => {
      const { readback } = readbackOf({ kind: 'failed', reason: 'PARSE_ERROR' });
      const dispatcher = new InventoryReadbackDispatcher({
        readbacks: new Map([[CTRIP, readback]]),
        logger: createLogger(),
        report: vi.fn(),
      });

      await expect(dispatcher.onReported(reportOf(), FAKE_WC, PARTITION)).resolves.toBeUndefined();
    });
  });
});
