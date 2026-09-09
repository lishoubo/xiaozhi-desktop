import { describe, expect, it, vi } from 'vitest';
import {
  createLoginRedirectGuard,
  isInternalPageLoginRedirect,
  type NavigationContext,
} from '../../../src/main/ipc/internal-page-handlers';

const RMS_WEB_ORIGIN = 'https://rms.example.com';

function context(overrides: Partial<NavigationContext> = {}): NavigationContext {
  return {
    tabId: 'tab-1',
    channelId: 'xiaozhi',
    url: `${RMS_WEB_ORIGIN}/login`,
    ...overrides,
  };
}

function createDeps(accessToken: () => Promise<string> = async () => 'fresh-token') {
  return {
    browserManager: { loadUrl: vi.fn(), close: vi.fn() },
    rmsWebOrigin: RMS_WEB_ORIGIN,
    accessToken: vi.fn(accessToken),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

/** 让守卫内部那段 `void (async ...)` 跑完。 */
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('isInternalPageLoginRedirect', () => {
  it('内部页面跳本 RMS 登录页 → 认', () => {
    expect(isInternalPageLoginRedirect(context(), RMS_WEB_ORIGIN)).toBe(true);
  });

  it('内部页面的其他导航 → 不认', () => {
    const target = context({ url: `${RMS_WEB_ORIGIN}/unified-pricing?token=x` });
    expect(isInternalPageLoginRedirect(target, RMS_WEB_ORIGIN)).toBe(false);
  });

  /** OTA 标签页有自己的登录流程，绝不能被这条策略碰到。 */
  it('非内部页面的标签页 → 不认', () => {
    const target = context({ channelId: 'ctrip', url: `${RMS_WEB_ORIGIN}/login` });
    expect(isInternalPageLoginRedirect(target, RMS_WEB_ORIGIN)).toBe(false);
  });

  /** 别的站点即便路径也叫 /login，也与我们无关。 */
  it('其他站点的 /login → 不认', () => {
    const target = context({ url: 'https://evil.example.com/login' });
    expect(isInternalPageLoginRedirect(target, RMS_WEB_ORIGIN)).toBe(false);
  });

  it('非法 URL → 不认，且不抛', () => {
    const target = context({ url: 'not-a-url' });
    expect(() => isInternalPageLoginRedirect(target, RMS_WEB_ORIGIN)).not.toThrow();
    expect(isInternalPageLoginRedirect(target, RMS_WEB_ORIGIN)).toBe(false);
  });
});

describe('createLoginRedirectGuard', () => {
  it('拦下跳转并用新令牌重载', async () => {
    const deps = createDeps();
    const guard = createLoginRedirectGuard(deps);

    expect(guard(context())).toBe(true);
    await flush();

    expect(deps.browserManager.loadUrl).toHaveBeenCalledOnce();
    const [tabId, url] = deps.browserManager.loadUrl.mock.calls[0]!;
    expect(tabId).toBe('tab-1');
    expect(new URL(url).searchParams.get('token')).toBe('fresh-token');
    expect(new URL(url).pathname).toBe('/unified-pricing');
    expect(deps.browserManager.close).not.toHaveBeenCalled();
  });

  it('不是登录页跳转时放行，且不取令牌', async () => {
    const deps = createDeps();
    const guard = createLoginRedirectGuard(deps);

    expect(guard(context({ url: `${RMS_WEB_ORIGIN}/unified-pricing` }))).toBe(false);
    await flush();

    expect(deps.accessToken).not.toHaveBeenCalled();
    expect(deps.browserManager.loadUrl).not.toHaveBeenCalled();
  });

  /**
   * 主进程会话也失效时**关掉标签页**，不能让它落到 RMS 登录页 —— desktop 用户
   * 在那里没有可用的登录手段（登录入口在应用自身，且可能是短信登录）。
   */
  it('会话已失效时关闭标签页', async () => {
    const deps = createDeps(async () => {
      const error = new Error('尚未登录');
      error.name = 'RmsSessionMissingError';
      throw error;
    });
    const guard = createLoginRedirectGuard(deps);

    expect(guard(context())).toBe(true);
    await flush();

    expect(deps.browserManager.close).toHaveBeenCalledWith('tab-1');
    expect(deps.browserManager.loadUrl).not.toHaveBeenCalled();
  });

  /**
   * 🔴 死循环防线：换了新令牌还是被跳走，说明问题不在令牌上。没有上限的话这里会变成
   * 「拦截 → 重载 → 又跳 → 再拦截」，页面疯狂闪烁且永远打不开。
   */
  it('连续跳转超过上限后关闭标签页，不再重载', async () => {
    const deps = createDeps();
    const guard = createLoginRedirectGuard(deps);

    guard(context());
    await flush();
    guard(context());
    await flush();
    const third = guard(context());
    await flush();

    expect(third).toBe(true);
    expect(deps.browserManager.loadUrl).toHaveBeenCalledTimes(2);
    expect(deps.browserManager.close).toHaveBeenCalledWith('tab-1');
  });

  it('不同标签页各自计数，互不影响', async () => {
    const deps = createDeps();
    const guard = createLoginRedirectGuard(deps);

    for (let i = 0; i < 3; i += 1) {
      guard(context({ tabId: 'tab-a' }));
      await flush();
    }
    deps.browserManager.close.mockClear();

    guard(context({ tabId: 'tab-b' }));
    await flush();

    // tab-a 已超限被关，tab-b 是第一次，应当正常重载而不是被连坐。
    expect(deps.browserManager.close).not.toHaveBeenCalled();
  });

  /** URL 带令牌，任何一条日志都不得把它写出去。 */
  it('日志不含 URL 与令牌', async () => {
    const deps = createDeps();
    const guard = createLoginRedirectGuard(deps);

    guard(context());
    await flush();

    const logged = [...deps.logger.info.mock.calls, ...deps.logger.warn.mock.calls]
      .flat()
      .map((entry) => JSON.stringify(entry))
      .join(' ');
    expect(logged).not.toContain('fresh-token');
    expect(logged).not.toContain('/unified-pricing');
    expect(logged).not.toContain(RMS_WEB_ORIGIN);
  });
});
