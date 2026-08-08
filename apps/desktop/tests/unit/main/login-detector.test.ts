import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { toChannelId } from '../../../src/main/ids';
import { LoginDetector } from '../../../src/main/ota-tab/login-detector';
import { TabEventBus } from '../../../src/main/ota-tab/tab-event-bus';

/** 真实 EventEmitter 充当 mock BrowserManager，保留 tab:navigated/tab:closed 订阅语义。 */
function createBrowserManagerStub() {
  return new EventEmitter();
}

/** handleTabNavigated 是 fire-and-forget 的 async，emit 后需要 flush microtask 队列。 */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const CTRIP = toChannelId('ctrip');

function setup(options: { isPastLogin?: (url: string) => boolean; registered?: boolean } = {}) {
  const browserManager = createBrowserManagerStub();
  const tabEventBus = new TabEventBus();
  const checked: unknown[] = [];
  tabEventBus.on('tab:credential-checked', (event: unknown) => checked.push(event));

  const triggerDiscovery = vi.fn().mockResolvedValue(null);
  const matcher = {
    channel: CTRIP,
    isPastLogin: options.isPastLogin ?? ((url: string) => url.includes('/home')),
  };
  const detector = new LoginDetector({
    browserManager: browserManager as never,
    tabEventBus,
    loginUrlMatchers: new Map(options.registered === false ? [] : [[CTRIP, matcher]]),
    triggerDiscovery,
  });

  const navigate = (url: string, tabId = 'tab-1') =>
    browserManager.emit('tab:navigated', {
      tabId,
      partitionName: 'persist:xiaozhi:prod:ctrip:abc',
      channelId: CTRIP,
      url,
      webContents: {} as never,
    });

  return { detector, browserManager, triggerDiscovery, checked, navigate };
}

describe('LoginDetector', () => {
  it('register 传入的 intent 随广播带出', async () => {
    const { detector, checked, navigate } = setup();

    detector.register('tab-1', CTRIP, { kind: 'bind-hotel', requestId: 'req-1' });
    navigate('https://ebooking.ctrip.com/home');
    await flush();

    expect(checked).toEqual([
      expect.objectContaining({ intent: { kind: 'bind-hotel', requestId: 'req-1' } }),
    ]);
  });

  it('tab 关闭后 intent 随记录一起消失，后续广播不再带出', async () => {
    const { detector, browserManager, checked, navigate } = setup();

    detector.register('tab-1', CTRIP, { kind: 'bind-hotel', requestId: 'req-1' });
    browserManager.emit('tab:closed', { tabId: 'tab-1' });
    navigate('https://ebooking.ctrip.com/home');
    await flush();

    expect(checked).toEqual([expect.objectContaining({ intent: undefined })]);
  });

  it('登记后导航命中登录判据即触发 discovery 并广播 checked', async () => {
    const { detector, triggerDiscovery, checked, navigate } = setup();

    detector.register('tab-1', CTRIP);
    navigate('https://ebooking.ctrip.com/home');
    await flush();

    expect(triggerDiscovery).toHaveBeenCalledOnce();
    expect(checked).toEqual([expect.objectContaining({ outcome: { kind: 'checked', credential: null } })]);
  });

  /**
   * 时序回归（历史踩坑，见 split-ota-hotel-prob-feature）：广播必须晚于写库
   * 完成，否则下游 HotelProbeDispatcher 查到 null 会永久错过探测机会
   * ——携程场景下标签页只导航一次，没有第二次机会。
   */
  it('广播 tab:credential-checked 发生在 triggerDiscovery 写库完成之后', async () => {
    const order: string[] = [];
    const browserManager = createBrowserManagerStub();
    const tabEventBus = new TabEventBus();
    tabEventBus.on('tab:credential-checked', () => order.push('broadcast'));

    let resolveWrite: (() => void) | undefined;
    const writeFinished = new Promise<void>((resolve) => {
      resolveWrite = resolve;
    });
    const detector = new LoginDetector({
      browserManager: browserManager as never,
      tabEventBus,
      loginUrlMatchers: new Map([
        [CTRIP, { channel: CTRIP, isPastLogin: () => true }],
      ]),
      triggerDiscovery: async () => {
        await writeFinished;
        order.push('db-write-done');
        return null;
      },
    });

    detector.register('tab-1', CTRIP);
    browserManager.emit('tab:navigated', {
      tabId: 'tab-1',
      partitionName: 'p',
      channelId: CTRIP,
      url: 'https://ebooking.ctrip.com/home',
      webContents: {} as never,
    });
    await flush();

    // 写库尚未完成：此时绝不能已经广播。
    expect(order).toEqual([]);

    resolveWrite?.();
    await flush();

    expect(order).toEqual(['db-write-done', 'broadcast']);
  });

  it('URL 未过登录页时广播 not-yet-past-login，不触发 discovery', async () => {
    const { detector, triggerDiscovery, checked, navigate } = setup();

    detector.register('tab-1', CTRIP);
    navigate('https://passport.ctrip.com/login');
    await flush();

    expect(triggerDiscovery).not.toHaveBeenCalled();
    expect(checked).toEqual([expect.objectContaining({ outcome: { kind: 'not-yet-past-login' } })]);
  });

  it('命中一次后再次导航不重复触发 discovery', async () => {
    const { detector, triggerDiscovery, navigate } = setup();

    detector.register('tab-1', CTRIP);
    navigate('https://ebooking.ctrip.com/home');
    await flush();
    navigate('https://ebooking.ctrip.com/home?again=1');
    await flush();

    expect(triggerDiscovery).toHaveBeenCalledOnce();
  });

  it('渠道未注册 matcher 时不参与判定，广播 not-applicable', async () => {
    const { detector, triggerDiscovery, checked, navigate } = setup({ registered: false });

    detector.register('tab-1', CTRIP);
    navigate('https://ebooking.ctrip.com/home');
    await flush();

    expect(triggerDiscovery).not.toHaveBeenCalled();
    expect(checked).toEqual([expect.objectContaining({ outcome: { kind: 'not-applicable' } })]);
  });

  it('tab:closed 后清理登记状态，同一 tabId 再次导航视为未登记', async () => {
    const { detector, browserManager, triggerDiscovery, navigate } = setup();

    detector.register('tab-1', CTRIP);
    browserManager.emit('tab:closed', { tabId: 'tab-1' });
    navigate('https://ebooking.ctrip.com/home');
    await flush();

    expect(triggerDiscovery).not.toHaveBeenCalled();
  });
});
