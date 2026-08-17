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

  /**
   * 「新登录账号」这条链的关键时序：新开的 tab 先落在**登录页**（不命中判据），
   * 用户登完之后才导航到已登录页。intent 必须活过中间那些不命中的导航——它挂在
   * tab 记录上，只有 tab 关闭才清，所以第二次导航仍然带得出来。
   *
   * 这条链没法用单测端到端跑（要真的开浏览器登录），这里锁住的是主进程侧的时序。
   */
  it('新登录：先停在登录页不触发，登完再导航时 intent 仍在', async () => {
    const { detector, triggerDiscovery, checked, navigate } = setup();
    const intent = { kind: 'bind-hotel', requestId: 'req-1' } as const;

    detector.register('tab-1', CTRIP, intent);

    // 第一次：落在登录页，还没登录
    navigate('https://ebooking.ctrip.com/login/index');
    await flush();
    expect(triggerDiscovery).not.toHaveBeenCalled();
    expect(checked).toEqual([
      expect.objectContaining({ outcome: { kind: 'not-yet-past-login' }, intent }),
    ]);

    // 第二次：用户登完跳走
    navigate('https://ebooking.ctrip.com/home');
    await flush();

    expect(triggerDiscovery).toHaveBeenCalledOnce();
    expect(checked[1]).toEqual(
      expect.objectContaining({ outcome: { kind: 'checked', credential: null }, intent }),
    );
  });

  it('登记后导航命中登录判据即触发 discovery 并广播 checked', async () => {
    const { detector, triggerDiscovery, checked, navigate } = setup();

    detector.register('tab-1', CTRIP);
    navigate('https://ebooking.ctrip.com/home');
    await flush();

    expect(triggerDiscovery).toHaveBeenCalledOnce();
    expect(checked).toEqual([
      expect.objectContaining({ outcome: { kind: 'checked', credential: null } }),
    ]);
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
      loginUrlMatchers: new Map([[CTRIP, { channel: CTRIP, isPastLogin: () => true }]]),
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

  it('探测成功后再次导航不重复触发 discovery', async () => {
    const { detector, triggerDiscovery, navigate } = setup();
    triggerDiscovery.mockResolvedValue({ id: 'cred-1' });

    detector.register('tab-1', CTRIP);
    navigate('https://ebooking.ctrip.com/home');
    await flush();
    navigate('https://ebooking.ctrip.com/home?again=1');
    await flush();

    expect(triggerDiscovery).toHaveBeenCalledOnce();
  });

  /**
   * 回归：探测失败（返回 null）不能把这个 tab 判死。
   *
   * 原实现在**进入** triggerDiscovery 之前就 `triggered.add(tabId)` 且失败不移除，
   * 于是一次失败之后该 tab 内的任何后续导航都直接走 not-applicable，用户刷新也没用，
   * 必须关掉标签页重开。抖音探测有轮询超时、页面慢一点就返回 null，这条路很常走。
   */
  it('探测失败后同一 tab 再次导航会重新触发 discovery', async () => {
    const { detector, triggerDiscovery, navigate } = setup();

    detector.register('tab-1', CTRIP);
    navigate('https://ebooking.ctrip.com/home');
    await flush();
    expect(triggerDiscovery).toHaveBeenCalledOnce();

    navigate('https://ebooking.ctrip.com/home?again=1');
    await flush();

    expect(triggerDiscovery).toHaveBeenCalledTimes(2);
  });

  /**
   * 失败可重试**不等于**可并发：同一 tab 上一次探测还没落定时又来一次导航，
   * 不能叠第二次探测。这里锁的是 tab 维度的门；partition 维度的并发保护在
   * `OtaCredentialService.inflight`，两者分工见 login-detector.ts 注释。
   */
  it('探测进行中再次导航不叠加第二次 discovery', async () => {
    const browserManager = createBrowserManagerStub();
    const tabEventBus = new TabEventBus();
    let pendingCount = 0;
    const triggerDiscovery = vi.fn(async () => {
      pendingCount += 1;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      return null;
    });
    const detector = new LoginDetector({
      browserManager: browserManager as never,
      tabEventBus,
      loginUrlMatchers: new Map([[CTRIP, { channel: CTRIP, isPastLogin: () => true }]]),
      triggerDiscovery,
    });

    detector.register('tab-1', CTRIP);
    const navigate = (url: string) =>
      browserManager.emit('tab:navigated', {
        tabId: 'tab-1',
        partitionName: 'p',
        channelId: CTRIP,
        url,
        webContents: {} as never,
      });

    navigate('https://ebooking.ctrip.com/home');
    navigate('https://ebooking.ctrip.com/home?again=1');
    await flush();

    expect(pendingCount).toBe(1);
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
