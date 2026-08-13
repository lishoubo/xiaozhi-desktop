import { describe, expect, it, vi, type Mock } from 'vitest';
import { AmountSaveCapture } from '../../../src/main/channels/amount-save-capture';
import { toChannelId } from '../../../src/main/ids';
import type { AmountChangeAdapter } from '../../../src/main/channels/types';
import type {
  AmountSaveObserved,
  OtaAmountChangeObserved,
} from '../../../src/shared/types/amount-change';
import type { JsonObject } from '../../../src/shared/types/json';

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

/**
 * 假适配器。`parse` 是个 spy —— 本文件测的是**机制**（配对、分流、上下文生命周期），
 * 不是任何一个渠道的解读逻辑，所以断言大多看的是「机制交给 parse 的是什么」，
 * 而不是 parse 返回了什么。
 */
function createAdapter(overrides: Partial<AmountChangeAdapter> = {}): AmountChangeAdapter {
  return {
    isWatchableUrl: () => true,
    watchedEndpoints: new Map([
      ['save_amount_calendar', '/life/trip/hotel/save_amount_calendar'],
      ['calc', '/life/trip/hotel/calc'],
    ]),
    isSuccessful: (body: string) => body.includes('"StatusCode":0'),
    parse: vi.fn((observed) => ({ kind: 'report' as const, report: reportOf(observed) })),
    ...overrides,
  };
}

/** 把观测到的原始事实包成一份最小上报体 —— 字段值本身不是本文件的关注点。 */
function reportOf(observed: AmountSaveObserved): OtaAmountChangeObserved {
  return {
    source: toChannelId('douyin'),
    endpointId: observed.endpointId,
    endpointUrl: observed.endpointUrl,
    otaHotelId: '',
    changeRaw: observed.requestBody,
  };
}

/** 机制层交给 `parse` 的第一个参数 —— 配对好的原始事实。 */
function observedAt(adapter: AmountChangeAdapter, call: number): AmountSaveObserved {
  return (adapter.parse as unknown as Mock).mock.calls[call][0] as AmountSaveObserved;
}

/** 机制层交给 `parse` 的第二个参数 —— 当前存着的上下文。 */
function contextAt(adapter: AmountChangeAdapter, call: number): JsonObject | null {
  return (adapter.parse as unknown as Mock).mock.calls[call][1] as JsonObject | null;
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
    const adapter = createAdapter();
    const capture = new AmountSaveCapture(
      webContents as never,
      adapter,
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
    expect(observedAt(adapter, 0)).toEqual({
      endpointId: 'save_amount_calendar',
      endpointUrl: SAVE_URL,
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
    const adapter = createAdapter();
    const capture = new AmountSaveCapture(
      webContents as never,
      adapter,
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
    expect(observedAt(adapter, 0).pageUrl).toBe(referer);
  });

  it('referer 缺失时退回地址栏', async () => {
    const webContents = createFakeWebContents({
      'Network.getResponseBody': { body: SUCCESS_RESPONSE, base64Encoded: false },
    });
    const onObserved = vi.fn();
    const adapter = createAdapter();
    const capture = new AmountSaveCapture(
      webContents as never,
      adapter,
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

    expect(observedAt(adapter, 0).pageUrl).toBe(PAGE_URL);
  });

  it('渠道判定失败时不交出观测结果', async () => {
    const rejected = '{"BaseResp":{"StatusCode":103810209,"StatusMessage":"限价规则"}}';
    const webContents = createFakeWebContents({
      'Network.getResponseBody': { body: rejected, base64Encoded: false },
    });
    const onObserved = vi.fn();
    const adapter = createAdapter();
    const capture = new AmountSaveCapture(
      webContents as never,
      adapter,
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
    const adapter = createAdapter();
    const capture = new AmountSaveCapture(
      webContents as never,
      adapter,
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
    const adapter = createAdapter();
    const capture = new AmountSaveCapture(
      webContents as never,
      adapter,
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
    const adapter = createAdapter();
    const capture = new AmountSaveCapture(
      webContents as never,
      adapter,
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

    // 返回 false 才能让调用方知道「没挂上」—— 跳过时不抛错，只看有没有 throw 会误判成功。
    await expect(capture.attach()).resolves.toBe(false);
    expect(webContents.debugger.attach).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();

    capture.detach();
    expect(webContents.debugger.detach).not.toHaveBeenCalled();
  });

  it('正常挂上时返回 true', async () => {
    const webContents = createFakeWebContents();
    const capture = new AmountSaveCapture(
      webContents as never,
      createAdapter(),
      createLogger(),
      vi.fn(),
    );

    await expect(capture.attach()).resolves.toBe(true);
  });

  /**
   * 页面级上下文的三条规则（美团 `calcPriceV2` 是唯一用它的渠道，但机制本身渠道无关）：
   * 不上报、覆盖式、随 detach 作废。
   */
  describe('页面级上下文', () => {
    const CALC_URL = 'https://life.douyin.com/life/trip/hotel/calc';

    /** 走一遍「请求 → 响应」，requestId 各不相同以免相互干扰。 */
    async function roundTrip(
      webContents: ReturnType<typeof createFakeWebContents>,
      url: string,
      requestId: string,
      body = REQUEST_BODY,
    ): Promise<void> {
      webContents.emit('Network.requestWillBeSent', {
        requestId,
        request: { url, postData: body },
      });
      await flushMicrotasks();
      webContents.emit('Network.loadingFinished', { requestId });
      await flushMicrotasks();
    }

    function createContextAdapter(): AmountChangeAdapter {
      return createAdapter({
        // 素材端点交出上下文，保存端点照常上报 —— 与美团适配器同一形状。
        parse: vi.fn((observed) =>
          observed.endpointId === 'calc'
            ? { kind: 'context' as const, context: observed.requestBody }
            : { kind: 'report' as const, report: reportOf(observed) },
        ),
      });
    }

    it('交出上下文的那次不上报，随后的保存拿得到它', async () => {
      const webContents = createFakeWebContents({
        'Network.getResponseBody': { body: SUCCESS_RESPONSE, base64Encoded: false },
      });
      const onObserved = vi.fn();
      const adapter = createContextAdapter();
      const capture = new AmountSaveCapture(
        webContents as never,
        adapter,
        createLogger(),
        onObserved,
      );
      await capture.attach();

      await roundTrip(webContents, CALC_URL, '1.1', '{"calc":1}');
      // 试算不构成一次改价
      expect(onObserved).not.toHaveBeenCalled();

      await roundTrip(webContents, SAVE_URL, '1.2');
      expect(onObserved).toHaveBeenCalledTimes(1);
      // 第一次（试算）时还没有上下文，第二次（保存）拿到的是试算留下的
      expect(contextAt(adapter, 0)).toBeNull();
      expect(contextAt(adapter, 1)).toEqual({ calc: 1 });
    });

    /** 页面上任何影响价格的条件变更都会触发重算，所以「取最新」天然与提交体同条件。 */
    it('后来的上下文覆盖先前的', async () => {
      const webContents = createFakeWebContents({
        'Network.getResponseBody': { body: SUCCESS_RESPONSE, base64Encoded: false },
      });
      const adapter = createContextAdapter();
      const capture = new AmountSaveCapture(
        webContents as never,
        adapter,
        createLogger(),
        vi.fn(),
      );
      await capture.attach();

      await roundTrip(webContents, CALC_URL, '1.1', '{"calc":1}');
      await roundTrip(webContents, CALC_URL, '1.2', '{"calc":2}');
      await roundTrip(webContents, SAVE_URL, '1.3');

      expect(contextAt(adapter, 2)).toEqual({ calc: 2 });
    });

    /** detach = 页面会话结束。下一次进改价页不该沿用上一次的试算结果。 */
    it('detach 之后上下文作废', async () => {
      const webContents = createFakeWebContents({
        'Network.getResponseBody': { body: SUCCESS_RESPONSE, base64Encoded: false },
      });
      const adapter = createContextAdapter();
      const capture = new AmountSaveCapture(
        webContents as never,
        adapter,
        createLogger(),
        vi.fn(),
      );
      await capture.attach();

      await roundTrip(webContents, CALC_URL, '1.1', '{"calc":1}');
      capture.detach();
      await capture.attach();
      await roundTrip(webContents, SAVE_URL, '1.2');

      expect(contextAt(adapter, 1)).toBeNull();
    });

    /** parse 返回 null（丢弃）时既不上报，也不该动上下文。 */
    it('丢弃的那次不影响已存的上下文', async () => {
      const webContents = createFakeWebContents({
        'Network.getResponseBody': { body: SUCCESS_RESPONSE, base64Encoded: false },
      });
      const onObserved = vi.fn();
      const adapter = createAdapter({
        parse: vi.fn((observed) => {
          if (observed.endpointId === 'calc') {
            return { kind: 'context' as const, context: observed.requestBody };
          }
          // 第一条保存丢弃（模拟美团的预检），第二条正常上报
          return observed.requestBody.discard === true
            ? null
            : { kind: 'report' as const, report: reportOf(observed) };
        }),
      });
      const capture = new AmountSaveCapture(
        webContents as never,
        adapter,
        createLogger(),
        onObserved,
      );
      await capture.attach();

      await roundTrip(webContents, CALC_URL, '1.1', '{"calc":1}');
      await roundTrip(webContents, SAVE_URL, '1.2', '{"discard":true}');
      await roundTrip(webContents, SAVE_URL, '1.3');

      expect(onObserved).toHaveBeenCalledTimes(1);
      expect(contextAt(adapter, 2)).toEqual({ calc: 1 });
    });
  });
});
