import { describe, expect, it, vi } from 'vitest';
import { AmountSaveCapture } from '../../../src/main/channels/amount-save-capture';
import type { AmountChangeAdapter } from '../../../src/main/channels/types';

const SAVE_URL = 'https://life.douyin.com/life/trip/hotel/save_amount_calendar?x=1';
const PAGE_URL = 'https://life.douyin.com/p/travel-ari/hotel/price?poi_id=777';
const REQUEST_BODY = '{"product_list":[{"product_id":"1","normal_price":100}]}';
const SUCCESS_RESPONSE = '{"BaseResp":{"StatusCode":0}}';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/**
 * 假的 `webContents.debugger`：把 CDP 事件当成可以手动触发的东西，这样用例可以精确控制
 * 事件顺序 —— 配对逻辑的正确性完全取决于顺序。
 */
function createFakeWebContents(
  commandResults: Readonly<Record<string, unknown>> = {},
  options: Readonly<{ alreadyAttached?: boolean }> = {},
) {
  let attached = options.alreadyAttached ?? false;
  const listeners: ((event: unknown, method: string, params: unknown) => void)[] = [];
  const sendCommand = vi.fn((method: string) => {
    if (method in commandResults) {
      const result = commandResults[method];
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
    }
    return Promise.resolve({});
  });

  return {
    getURL: () => PAGE_URL,
    debugger: {
      isAttached: () => attached,
      attach: vi.fn(() => {
        attached = true;
      }),
      detach: vi.fn(() => {
        attached = false;
      }),
      sendCommand,
      on: (_name: string, listener: (event: unknown, method: string, params: unknown) => void) => {
        listeners.push(listener);
      },
      removeListener: vi.fn(),
    },
    /** 把一个 CDP 事件喂给所有已注册的监听器。 */
    emit(method: string, params: unknown): void {
      for (const listener of listeners) listener(null, method, params);
    },
  };
}

function createAdapter(overrides: Partial<AmountChangeAdapter> = {}): AmountChangeAdapter {
  return {
    isWatchableUrl: () => true,
    saveEndpoints: new Map([['save_amount_calendar', '/life/trip/hotel/save_amount_calendar']]),
    isSuccessful: (body: string) => body.includes('"StatusCode":0'),
    parse: vi.fn(),
    ...overrides,
  };
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('AmountSaveCapture', () => {
  it('配对请求体与成功响应后交出观测结果', async () => {
    const webContents = createFakeWebContents({
      'Network.getResponseBody': { body: SUCCESS_RESPONSE, base64Encoded: false },
    });
    const onObserved = vi.fn();
    const capture = new AmountSaveCapture(
      webContents as never,
      createAdapter(),
      createLogger(),
      onObserved,
    );
    await capture.attach();

    webContents.emit('Network.requestWillBeSent', {
      requestId: '1.1',
      request: { url: SAVE_URL, postData: REQUEST_BODY },
    });
    await flushMicrotasks();
    webContents.emit('Network.loadingFinished', { requestId: '1.1' });
    await flushMicrotasks();

    expect(onObserved).toHaveBeenCalledTimes(1);
    expect(onObserved.mock.calls[0][0]).toEqual({
      endpointId: 'save_amount_calendar',
      requestBody: { product_list: [{ product_id: '1', normal_price: 100 }] },
      responseBody: SUCCESS_RESPONSE,
      pageUrl: PAGE_URL,
    });
  });

  /**
   * 真机验证发现的 bug（2026-08-10）：抖音改价页是 SPA，选了哪家门店不回写地址栏，
   * 所以 `webContents.getURL()` 里没有 `poi_id`，referer 里才有。pageUrl 必须取 referer。
   */
  it('pageUrl 取 referer 而不是地址栏', async () => {
    const webContents = createFakeWebContents({
      'Network.getResponseBody': { body: SUCCESS_RESPONSE, base64Encoded: false },
    });
    const onObserved = vi.fn();
    const capture = new AmountSaveCapture(
      webContents as never,
      createAdapter(),
      createLogger(),
      onObserved,
    );
    await capture.attach();

    const referer = 'https://life.douyin.com/p/travel-ari/hotel/price?poi_id=999&groupid=1';
    webContents.emit('Network.requestWillBeSent', {
      requestId: '1.1',
      request: {
        url: SAVE_URL,
        postData: REQUEST_BODY,
        // 大小写不敏感：CDP 给的头名大小写不保证。
        headers: { Referer: referer },
      },
    });
    await flushMicrotasks();
    webContents.emit('Network.loadingFinished', { requestId: '1.1' });
    await flushMicrotasks();

    // 地址栏是 PAGE_URL（poi_id=777），referer 是 poi_id=999 —— 必须用后者。
    expect(onObserved.mock.calls[0][0].pageUrl).toBe(referer);
  });

  it('referer 缺失时退回地址栏', async () => {
    const webContents = createFakeWebContents({
      'Network.getResponseBody': { body: SUCCESS_RESPONSE, base64Encoded: false },
    });
    const onObserved = vi.fn();
    const capture = new AmountSaveCapture(
      webContents as never,
      createAdapter(),
      createLogger(),
      onObserved,
    );
    await capture.attach();

    webContents.emit('Network.requestWillBeSent', {
      requestId: '1.1',
      request: { url: SAVE_URL, postData: REQUEST_BODY },
    });
    await flushMicrotasks();
    webContents.emit('Network.loadingFinished', { requestId: '1.1' });
    await flushMicrotasks();

    expect(onObserved.mock.calls[0][0].pageUrl).toBe(PAGE_URL);
  });

  it('渠道判定失败时不交出观测结果', async () => {
    const rejected = '{"BaseResp":{"StatusCode":103810209,"StatusMessage":"限价规则"}}';
    const webContents = createFakeWebContents({
      'Network.getResponseBody': { body: rejected, base64Encoded: false },
    });
    const onObserved = vi.fn();
    const capture = new AmountSaveCapture(
      webContents as never,
      createAdapter(),
      createLogger(),
      onObserved,
    );
    await capture.attach();

    webContents.emit('Network.requestWillBeSent', {
      requestId: '1.1',
      request: { url: SAVE_URL, postData: REQUEST_BODY },
    });
    await flushMicrotasks();
    webContents.emit('Network.loadingFinished', { requestId: '1.1' });
    await flushMicrotasks();

    expect(onObserved).not.toHaveBeenCalled();
  });

  it('postData 缺失时回退到 getRequestPostData', async () => {
    const webContents = createFakeWebContents({
      'Network.getRequestPostData': { postData: REQUEST_BODY },
      'Network.getResponseBody': { body: SUCCESS_RESPONSE, base64Encoded: false },
    });
    const onObserved = vi.fn();
    const capture = new AmountSaveCapture(
      webContents as never,
      createAdapter(),
      createLogger(),
      onObserved,
    );
    await capture.attach();

    // 请求体过大时 CDP 只给 hasPostData，不给 postData。
    webContents.emit('Network.requestWillBeSent', {
      requestId: '1.1',
      request: { url: SAVE_URL, hasPostData: true },
    });
    await flushMicrotasks();
    webContents.emit('Network.loadingFinished', { requestId: '1.1' });
    await flushMicrotasks();

    expect(webContents.debugger.sendCommand).toHaveBeenCalledWith('Network.getRequestPostData', {
      requestId: '1.1',
    });
    expect(onObserved).toHaveBeenCalledTimes(1);
  });

  it('loadingFailed 之后同一个 requestId 不再产出结果', async () => {
    const webContents = createFakeWebContents({
      'Network.getResponseBody': { body: SUCCESS_RESPONSE, base64Encoded: false },
    });
    const onObserved = vi.fn();
    const capture = new AmountSaveCapture(
      webContents as never,
      createAdapter(),
      createLogger(),
      onObserved,
    );
    await capture.attach();

    webContents.emit('Network.requestWillBeSent', {
      requestId: '1.1',
      request: { url: SAVE_URL, postData: REQUEST_BODY },
    });
    await flushMicrotasks();
    webContents.emit('Network.loadingFailed', { requestId: '1.1' });
    // 请求已经失败了，即便之后又来一个 loadingFinished 也不该产出结果（pending 已清）。
    webContents.emit('Network.loadingFinished', { requestId: '1.1' });
    await flushMicrotasks();

    expect(onObserved).not.toHaveBeenCalled();
  });

  it('不拦非保存端点的请求', async () => {
    const webContents = createFakeWebContents();
    const onObserved = vi.fn();
    const capture = new AmountSaveCapture(
      webContents as never,
      createAdapter(),
      createLogger(),
      onObserved,
    );
    await capture.attach();

    webContents.emit('Network.requestWillBeSent', {
      requestId: '1.1',
      request: {
        url: 'https://life.douyin.com/life/trip/hotel/check_amount_calendar',
        postData: REQUEST_BODY,
      },
    });
    await flushMicrotasks();
    webContents.emit('Network.loadingFinished', { requestId: '1.1' });
    await flushMicrotasks();

    expect(onObserved).not.toHaveBeenCalled();
  });

  it('debugger 已被占用时跳过 attach，且 detach 不掀别人的会话', async () => {
    const webContents = createFakeWebContents({}, { alreadyAttached: true });
    const logger = createLogger();
    const capture = new AmountSaveCapture(webContents as never, createAdapter(), logger, vi.fn());

    await capture.attach();
    expect(webContents.debugger.attach).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();

    capture.detach();
    expect(webContents.debugger.detach).not.toHaveBeenCalled();
  });
});
