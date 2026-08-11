import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { AmountChangeWatcher } from '../../../src/main/channels/amount-change-watcher';
import type { AmountChangeAdapter } from '../../../src/main/channels/types';
import { toChannelId } from '../../../src/main/ids';

const WATCHED_URL = 'https://life.douyin.com/p/travel-ari/hotel/price?poi_id=777&groupid=1';
const OTHER_URL = 'https://life.douyin.com/p/home?groupid=1';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function createFakeWebContents() {
  return {
    getURL: () => WATCHED_URL,
    debugger: {
      isAttached: () => false,
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
    saveEndpoints: new Map([['save_amount_calendar', '/save_amount_calendar']]),
    isSuccessful: () => true,
    parse: vi.fn(),
    ...overrides,
  };
}

function navigatedEvent(url: string, webContents: unknown, tabId = 'tab-1') {
  return {
    tabId,
    partitionName: 'persist:xiaozhi:prod:douyin:aaa',
    channelId: 'douyin',
    url,
    webContents,
  };
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

  it('渠道没有适配器时完全不监听', async () => {
    const browserManager = new EventEmitter();
    const webContents = createFakeWebContents();
    new AmountChangeWatcher({
      browserManager: browserManager as never,
      // 本期的携程/美团就是这个状态：注册表里没有 amountChangeAdapter。
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

  it('适配器解析不出酒店时不上报，但留下告警', async () => {
    const browserManager = new EventEmitter();
    const webContents = createFakeWebContents();
    webContents.debugger.sendCommand = vi.fn(() =>
      Promise.resolve({ body: '{"BaseResp":{"StatusCode":0}}', base64Encoded: false }),
    );
    const report = vi.fn();
    const logger = createLogger();
    // parse 返回 null（页面 URL 缺 poi_id）——这条上报对 RMS 无意义，应被丢弃。
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
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('could not locate the hotel'),
      expect.anything(),
    );
  });

  it('解析成功时把上报体交给窄回调', async () => {
    const browserManager = new EventEmitter();
    const webContents = createFakeWebContents();
    webContents.debugger.sendCommand = vi.fn(() =>
      Promise.resolve({ body: '{"BaseResp":{"StatusCode":0}}', base64Encoded: false }),
    );
    const report = vi.fn();
    const parsed = {
      source: toChannelId('douyin'),
      endpointId: 'save_amount_calendar',
      endpointUrl: 'https://life.douyin.com/life/trip/hotel/save_amount_calendar',
      otaHotelId: '777',
      requestBody: { a: 1 },
      responseBody: '{"BaseResp":{"StatusCode":0}}',
    };
    const adapter = createAdapter({ parse: () => parsed });
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
});
