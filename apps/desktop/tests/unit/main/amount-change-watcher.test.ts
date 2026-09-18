import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { AmountChangeWatcher } from '../../../src/main/channels/amount-change-watcher';
import type { AmountChangeAdapter } from '../../../src/main/channels/types';
import { toChannelId } from '../../../src/main/ids';
import type { OtaAmountChangeObserved } from '../../../src/shared/types/amount-change';

const WATCHED_URL = 'https://life.douyin.com/p/travel-ari/hotel/price?poi_id=777&groupid=1';
const OTHER_URL = 'https://life.douyin.com/p/home?groupid=1';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function createFakeWebContents(options: { busy?: () => boolean } = {}) {
  const isBusy = options.busy ?? (() => false);
  return {
    getURL: () => WATCHED_URL,
    debugger: {
      // `busy` 模拟酒店探测那条链路正占着 debugger（两者共用同一个 webContents）。
      isAttached: () => isBusy(),
      attach: vi.fn(),
      detach: vi.fn(),
      sendCommand: vi.fn(() => Promise.resolve({})),
      on: vi.fn(),
      removeListener: vi.fn(),
    },
  };
}

function createAdapter(overrides: Partial<AmountChangeAdapter> = {}): AmountChangeAdapter {
  return {
    isWatchableUrl: (url: string) => url.includes('/p/travel-ari/hotel/price'),
    watchedEndpoints: new Map([['save_amount_calendar', '/save_amount_calendar']]),
    isSuccessful: () => true,
    parse: vi.fn(),
    ...overrides,
  };
}

function navigatedEvent(
  url: string,
  webContents: unknown,
  tabId = 'tab-1',
  partitionName = 'persist:xiaozhi:prod:douyin:aaa',
) {
  return { tabId, partitionName, channelId: 'douyin', url, webContents };
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('AmountChangeWatcher', () => {
  it('进入监听页时 attach，离开时 detach', async () => {
    const browserManager = new EventEmitter();
    const webContents = createFakeWebContents();
    new AmountChangeWatcher({
      browserManager: browserManager as never,
      adapters: new Map([[toChannelId('douyin'), createAdapter()]]),
      logger: createLogger(),
      report: vi.fn(),
    });

    browserManager.emit('tab:navigated', navigatedEvent(WATCHED_URL, webContents));
    await flushMicrotasks();
    expect(webContents.debugger.attach).toHaveBeenCalledTimes(1);

    browserManager.emit('tab:navigated', navigatedEvent(OTHER_URL, webContents));
    await flushMicrotasks();
    expect(webContents.debugger.removeListener).toHaveBeenCalled();
  });

  it('同一个页面内重复导航只 attach 一次', async () => {
    const browserManager = new EventEmitter();
    const webContents = createFakeWebContents();
    new AmountChangeWatcher({
      browserManager: browserManager as never,
      adapters: new Map([[toChannelId('douyin'), createAdapter()]]),
      logger: createLogger(),
      report: vi.fn(),
    });

    // SPA 在同一页内改 URL（切日期、筛选）会连发多次导航事件。
    browserManager.emit('tab:navigated', navigatedEvent(WATCHED_URL, webContents));
    await flushMicrotasks();
    browserManager.emit('tab:navigated', navigatedEvent(`${WATCHED_URL}&roomType=2`, webContents));
    await flushMicrotasks();

    expect(webContents.debugger.attach).toHaveBeenCalledTimes(1);
  });

  it('debugger 被占用时不谎报「已启动」，而是明确记 warn', async () => {
    const browserManager = new EventEmitter();
    const webContents = createFakeWebContents({ busy: () => true });
    const logger = createLogger();
    new AmountChangeWatcher({
      browserManager: browserManager as never,
      adapters: new Map([[toChannelId('douyin'), createAdapter()]]),
      logger,
      report: vi.fn(),
    });

    browserManager.emit('tab:navigated', navigatedEvent(WATCHED_URL, webContents));
    await flushMicrotasks();

    // 真机排查时「已启动 + 改价没反应」最难查，成功日志绝不能在没挂上时出现。
    expect(logger.info).not.toHaveBeenCalledWith(
      'Amount change watching started',
      expect.anything(),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'Amount change watcher: not watching, debugger is busy',
      expect.objectContaining({ channel: 'douyin' }),
    );
  });

  it('debugger 占用解除后，下一次导航还能重新挂上（不被死 capture 卡死）', async () => {
    const browserManager = new EventEmitter();
    let busy = true;
    const webContents = createFakeWebContents({ busy: () => busy });
    new AmountChangeWatcher({
      browserManager: browserManager as never,
      adapters: new Map([[toChannelId('douyin'), createAdapter()]]),
      logger: createLogger(),
      report: vi.fn(),
    });

    // 第一次：探测占着 debugger，没挂上。
    browserManager.emit('tab:navigated', navigatedEvent(WATCHED_URL, webContents));
    await flushMicrotasks();
    expect(webContents.debugger.attach).not.toHaveBeenCalled();

    // 探测结束让出 debugger。若失败时没撤销登记，`captures.has()` 会把这个 tab
    // 永久判成「已在监听」，此后再也挂不上 —— 这条用例锁的就是那个回归。
    busy = false;
    browserManager.emit('tab:navigated', navigatedEvent(`${WATCHED_URL}&d=2`, webContents));
    await flushMicrotasks();
    expect(webContents.debugger.attach).toHaveBeenCalledTimes(1);
  });

  it('渠道没有适配器时完全不监听', async () => {
    const browserManager = new EventEmitter();
    const webContents = createFakeWebContents();
    new AmountChangeWatcher({
      browserManager: browserManager as never,
      // 将来新接、尚未踩点的渠道就是这个状态：注册表里没有 amountChangeAdapter。
      adapters: new Map(),
      logger: createLogger(),
      report: vi.fn(),
    });

    browserManager.emit('tab:navigated', navigatedEvent(WATCHED_URL, webContents));
    await flushMicrotasks();

    expect(webContents.debugger.attach).not.toHaveBeenCalled();
  });

  it('标签页关闭时停止监听', async () => {
    const browserManager = new EventEmitter();
    const webContents = createFakeWebContents();
    new AmountChangeWatcher({
      browserManager: browserManager as never,
      adapters: new Map([[toChannelId('douyin'), createAdapter()]]),
      logger: createLogger(),
      report: vi.fn(),
    });

    browserManager.emit('tab:navigated', navigatedEvent(WATCHED_URL, webContents));
    await flushMicrotasks();
    browserManager.emit('tab:closed', { tabId: 'tab-1' });

    expect(webContents.debugger.removeListener).toHaveBeenCalled();
  });

  /**
   * 下面两个用例要驱动完整的「拦到 → 解析 → 上报」链路，所以喂真实的 CDP 事件序列，
   * 而不是去戳 watcher 的私有字段。
   */
  function emitSaveRequest(webContents: ReturnType<typeof createFakeWebContents>): void {
    const listener = webContents.debugger.on.mock.calls.find(
      ([name]) => name === 'message',
    )?.[1] as ((event: unknown, method: string, params: unknown) => void) | undefined;
    if (!listener) throw new Error('capture 没有注册 CDP 监听器');
    listener(null, 'Network.requestWillBeSent', {
      requestId: '1.1',
      request: { url: 'https://life.douyin.com/save_amount_calendar', postData: '{"a":1}' },
    });
  }

  it('适配器丢弃这次观测时不上报', async () => {
    const browserManager = new EventEmitter();
    const webContents = createFakeWebContents();
    webContents.debugger.sendCommand = vi.fn(() =>
      Promise.resolve({ body: '{"BaseResp":{"StatusCode":0}}', base64Encoded: false }),
    );
    const report = vi.fn();
    const logger = createLogger();
    // parse 返回 null（定位不到酒店、或拦到的是不该上报的预检）——应被丢弃。
    // 丢弃原因的日志由适配器自己打（它才知道缺的是哪个字段），watcher 不重复记。
    const adapter = createAdapter({ parse: () => null });
    new AmountChangeWatcher({
      browserManager: browserManager as never,
      adapters: new Map([[toChannelId('douyin'), adapter]]),
      logger,
      report,
    });

    browserManager.emit('tab:navigated', navigatedEvent(WATCHED_URL, webContents));
    await flushMicrotasks();
    emitSaveRequest(webContents);
    await flushMicrotasks();
    const listener = webContents.debugger.on.mock.calls.find(
      ([name]) => name === 'message',
    )?.[1] as (event: unknown, method: string, params: unknown) => void;
    listener(null, 'Network.loadingFinished', { requestId: '1.1' });
    await flushMicrotasks();

    expect(report).not.toHaveBeenCalled();
  });

  it('解析成功时把上报体交给窄回调', async () => {
    const browserManager = new EventEmitter();
    const webContents = createFakeWebContents();
    webContents.debugger.sendCommand = vi.fn(() =>
      Promise.resolve({ body: '{"BaseResp":{"StatusCode":0}}', base64Encoded: false }),
    );
    const report = vi.fn();
    const parsed: OtaAmountChangeObserved = {
      source: toChannelId('douyin'),
      changeType: 'price',
      endpointId: 'save_amount_calendar',
      endpointUrl: 'https://life.douyin.com/life/trip/hotel/save_amount_calendar',
      otaHotelId: '777',
      changeRaw: { a: 1 },
    };
    const adapter = createAdapter({ parse: () => ({ kind: 'report', report: parsed }) });
    new AmountChangeWatcher({
      browserManager: browserManager as never,
      adapters: new Map([[toChannelId('douyin'), adapter]]),
      logger: createLogger(),
      report,
    });

    browserManager.emit('tab:navigated', navigatedEvent(WATCHED_URL, webContents));
    await flushMicrotasks();
    emitSaveRequest(webContents);
    await flushMicrotasks();
    const listener = webContents.debugger.on.mock.calls.find(
      ([name]) => name === 'message',
    )?.[1] as (event: unknown, method: string, params: unknown) => void;
    listener(null, 'Network.loadingFinished', { requestId: '1.1' });
    await flushMicrotasks();

    // 第二个参数是 partitionName —— service 侧靠它查渠道账号。
    expect(report).toHaveBeenCalledWith(parsed, expect.any(String));
  });

  /**
   * ⚠️ 多账号并存：每个标签页背后是**独立的 partition**（= 独立 cookie 存储，
   * `persist:xiaozhi:<env>:<channel>:<shortId>`，shortId 每次登录随机生成）。
   *
   * 用户在 A 标签登 A 酒店、B 标签登 B 酒店时，两条链路必须各走各的：上报要带**自己那个**
   * partitionName（service 侧靠它查渠道账号），回读要用**自己那个** webContents
   * （`executeJavaScript` 在哪个 WebContentsView 里执行，就带哪份 session 的 cookie）。
   *
   * 串了的后果极其严重且静默：把 A 酒店的房量报成 B 酒店的，服务端照着改另一家店的价。
   */
  it('两个标签页各自的 partition 与 webContents 不串', async () => {
    const browserManager = new EventEmitter();
    const wcA = createFakeWebContents();
    const wcB = createFakeWebContents();
    for (const wc of [wcA, wcB]) {
      wc.debugger.sendCommand = vi.fn(() =>
        Promise.resolve({ body: '{"BaseResp":{"StatusCode":0}}', base64Encoded: false }),
      );
    }
    const parsedA = { source: 'douyin', otaHotelId: 'hotel-A' } as unknown as OtaAmountChangeObserved;
    const parsedB = { source: 'douyin', otaHotelId: 'hotel-B' } as unknown as OtaAmountChangeObserved;
    // 按 webContents 区分这次观测来自哪个 tab —— 适配器本身不认识 tab，
    // 这里只是让测试能分辨两条链路。
    const adapter = createAdapter({
      parse: vi.fn((observed: { requestBody?: unknown }) =>
        JSON.stringify(observed).includes('tab-b')
          ? { kind: 'report' as const, report: parsedB }
          : { kind: 'report' as const, report: parsedA },
      ),
    });
    const report = vi.fn();
    const onReportedForReadback = vi.fn();
    new AmountChangeWatcher({
      browserManager: browserManager as never,
      adapters: new Map([[toChannelId('douyin'), adapter]]),
      logger: createLogger(),
      report,
      onReportedForReadback,
    });

    const PARTITION_A = 'persist:xiaozhi:prod:douyin:aaa';
    const PARTITION_B = 'persist:xiaozhi:prod:douyin:bbb';
    browserManager.emit('tab:navigated', navigatedEvent(WATCHED_URL, wcA, 'tab-a', PARTITION_A));
    browserManager.emit('tab:navigated', navigatedEvent(WATCHED_URL, wcB, 'tab-b', PARTITION_B));
    await flushMicrotasks();

    // 两个 tab 各自被 attach —— 不是共用一个 capture
    expect(wcA.debugger.attach).toHaveBeenCalledTimes(1);
    expect(wcB.debugger.attach).toHaveBeenCalledTimes(1);

    const fire = async (wc: typeof wcA, marker: string): Promise<void> => {
      const listener = wc.debugger.on.mock.calls.find(([name]) => name === 'message')?.[1] as (
        event: unknown,
        method: string,
        params: unknown,
      ) => void;
      listener(null, 'Network.requestWillBeSent', {
        requestId: '1.1',
        request: {
          url: 'https://life.douyin.com/save_amount_calendar',
          postData: `{"from":"${marker}"}`,
        },
      });
      // ⚠️ 必须先 flush：onRequestWillBeSent 是 async（postData 被省略时要异步取 body），
      // 同一 tick 内紧接着发 loadingFinished 会因 pending 尚未登记而被丢弃。
      await flushMicrotasks();
      listener(null, 'Network.loadingFinished', { requestId: '1.1' });
      await flushMicrotasks();
    };

    await fire(wcB, 'tab-b');
    await fire(wcA, 'tab-a');

    // 上报：各自带自己的 partitionName
    expect(report).toHaveBeenCalledWith(parsedB, PARTITION_B);
    expect(report).toHaveBeenCalledWith(parsedA, PARTITION_A);
    // ⛔ 绝不能出现 A 的报文配 B 的 partition
    expect(report).not.toHaveBeenCalledWith(parsedA, PARTITION_B);
    expect(report).not.toHaveBeenCalledWith(parsedB, PARTITION_A);

    // 回读：各自带自己的 webContents（cookie 一致性的根据）
    expect(onReportedForReadback).toHaveBeenCalledWith(parsedB, wcB, PARTITION_B);
    expect(onReportedForReadback).toHaveBeenCalledWith(parsedA, wcA, PARTITION_A);
    expect(onReportedForReadback).not.toHaveBeenCalledWith(parsedA, wcB, expect.anything());
    expect(onReportedForReadback).not.toHaveBeenCalledWith(parsedB, wcA, expect.anything());
  });
});
