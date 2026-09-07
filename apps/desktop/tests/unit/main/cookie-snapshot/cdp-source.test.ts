import { describe, expect, it, vi } from 'vitest';
import type { WebContents } from 'electron';
import { collectViaCdp } from '../../../../src/main/browser/cookie-snapshot/cdp-source';
import type { AppLogger } from '../../../../src/shared/logging';

const logger = (): AppLogger =>
  ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }) as unknown as AppLogger;

type DebuggerStub = {
  isAttached: ReturnType<typeof vi.fn>;
  attach: ReturnType<typeof vi.fn>;
  detach: ReturnType<typeof vi.fn>;
  sendCommand: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
};

function stubWebContents(
  overrides: Partial<DebuggerStub> = {},
  destroyed = false,
): { webContents: WebContents; dbg: DebuggerStub } {
  let attached = false;
  const dbg: DebuggerStub = {
    isAttached: vi.fn(() => attached),
    attach: vi.fn(() => {
      attached = true;
    }),
    detach: vi.fn(() => {
      attached = false;
    }),
    sendCommand: vi.fn().mockResolvedValue({ cookies: [] }),
    once: vi.fn(),
    removeListener: vi.fn(),
    ...overrides,
  };
  const webContents = {
    isDestroyed: () => destroyed,
    debugger: dbg,
  } as unknown as WebContents;
  return { webContents, dbg };
}

describe('CDP cookie 采集', () => {
  it('取到 cookie 并原样带出 partitionKey', async () => {
    const partitionKey = { topLevelSite: 'https://douyin.com', hasCrossSiteAncestor: false };
    const { webContents } = stubWebContents({
      sendCommand: vi.fn().mockResolvedValue({
        cookies: [
          {
            name: 'sessionid_ls',
            value: 'x',
            domain: '.life.douyin.com',
            path: '/',
            secure: true,
            httpOnly: true,
            sameSite: 'None',
            expires: 1793456000.123,
            session: false,
            partitionKey,
          },
        ],
      }),
    });

    const result = await collectViaCdp(webContents, logger());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cookies).toHaveLength(1);
    expect(result.cookies[0]?.partitionKey).toEqual(partitionKey);
  });

  /**
   * 探测链路（HotelProbe）正占着 debugger 时**不抢占** —— 探测是用户正在等结果的
   * 前台流程，抢占会让绑定流程失败。这条是本模块最关键的行为约束。
   */
  it('debugger 已被占用时不抢占，直接返回 debugger-busy', async () => {
    const { webContents, dbg } = stubWebContents({ isAttached: vi.fn(() => true) });

    const result = await collectViaCdp(webContents, logger());

    expect(result).toEqual({ ok: false, reason: 'debugger-busy' });
    expect(dbg.attach).not.toHaveBeenCalled();
    expect(dbg.detach).not.toHaveBeenCalled();
    expect(dbg.sendCommand).not.toHaveBeenCalled();
  });

  it('attach 抛错时返回 attach-failed，不尝试 detach', async () => {
    const { webContents, dbg } = stubWebContents({
      attach: vi.fn(() => {
        throw new Error('already attached by devtools');
      }),
    });

    const result = await collectViaCdp(webContents, logger());

    expect(result).toEqual({ ok: false, reason: 'attach-failed' });
    expect(dbg.detach).not.toHaveBeenCalled();
  });

  it('成功路径结束后 detach，不把 debugger 留给别人', async () => {
    const { webContents, dbg } = stubWebContents();

    await collectViaCdp(webContents, logger());

    expect(dbg.attach).toHaveBeenCalledOnce();
    expect(dbg.detach).toHaveBeenCalledOnce();
  });

  /**
   * 回归：await 期间别人（AmountChangeWatcher 在 tab:navigated 上）抢先 attach 时，
   * 不能把人家的会话掀掉 —— watcher 一旦判定「debugger 被占」就永久放弃这个 tab，
   * 表现为该标签页此后再也拦不到改价，日志上与「用户没改价」一模一样。
   */
  it('我们没能 attach 上时，绝不 detach 别人的会话', async () => {
    // 入口就被占用：debugger 从头到尾都是别人的
    const { webContents, dbg } = stubWebContents({ isAttached: vi.fn(() => true) });

    await collectViaCdp(webContents, logger());

    expect(dbg.detach).not.toHaveBeenCalled();
  });

  /**
   * 回归（review finding 1）：attach 成功后，`isAttached()` 在出口处为 true 并不证明
   * 占用者仍是我们 —— await 期间我们的会话可能掉线、别人（`AmountChangeWatcher` 在
   * `tab:navigated` 上）随即 attach 上来。旧实现在 `finally` 里靠 `isAttached()` 判断，
   * 会把别人刚建立的会话掀掉；watcher 一旦判定「debugger 被占」就**永久放弃**该 tab，
   * 表现为此后再也拦不到改价，日志上与「用户没改价」一模一样。
   *
   * 这里用调用序列锁住行为：detach 必须发生在**我们自己那一次** attach 之后，
   * 且只发生一次。
   */
  it('我们的会话在 await 期间掉线、别人接管后，不 detach 别人的', async () => {
    /**
     * 精确复现冲突：
     *   1. 入口 isAttached=false，我们 attach 成功（owner = 'us'）
     *   2. sendCommand 期间我们的会话掉线 —— Electron 抛出 `detach` 事件 —— 随后
     *      `AmountChangeWatcher` 在 tab:navigated 上 attach 上来（owner = 'other'）
     *   3. 出口处 isAttached 仍为 true，但持有者已不是我们
     *
     * 靠 `isAttached()` 判断的实现会在这里 detach，把 watcher 刚建立的会话掀掉。
     */
    let owner: 'none' | 'us' | 'other' = 'none';
    let onDetach: (() => void) | null = null;

    const dbg: DebuggerStub = {
      isAttached: vi.fn(() => owner !== 'none'),
      attach: vi.fn(() => {
        owner = 'us';
      }),
      detach: vi.fn(() => {
        owner = 'none';
      }),
      sendCommand: vi.fn(async () => {
        // 我们的会话掉线：Electron 通知我们已被解除
        owner = 'none';
        onDetach?.();
        // 别人立刻接管
        owner = 'other';
        return { cookies: [] };
      }),
      once: vi.fn((event: string, listener: () => void) => {
        if (event === 'detach') onDetach = listener;
      }),
      removeListener: vi.fn(),
    };
    const webContents = { isDestroyed: () => false, debugger: dbg } as unknown as WebContents;

    await collectViaCdp(webContents, logger());

    // 关键断言：别人的会话必须还在
    expect(owner).toBe('other');
    expect(dbg.detach).not.toHaveBeenCalled();
  });

  it('sendCommand 抛错时仍然 detach，不泄漏 attach 状态', async () => {
    const { webContents, dbg } = stubWebContents({
      sendCommand: vi.fn().mockRejectedValue(new Error('target closed')),
    });

    const result = await collectViaCdp(webContents, logger());

    expect(result).toEqual({ ok: false, reason: 'command-failed' });
    expect(dbg.detach).toHaveBeenCalledOnce();
  });

  it('返回体不是 cookie 列表时返回 command-failed', async () => {
    const { webContents } = stubWebContents({
      sendCommand: vi.fn().mockResolvedValue({ unexpected: true }),
    });

    expect(await collectViaCdp(webContents, logger())).toEqual({
      ok: false,
      reason: 'command-failed',
    });
  });

  it('没有标签页或已销毁时返回 no-tab', async () => {
    expect(await collectViaCdp(null, logger())).toEqual({ ok: false, reason: 'no-tab' });

    const { webContents } = stubWebContents({}, true);
    expect(await collectViaCdp(webContents, logger())).toEqual({ ok: false, reason: 'no-tab' });
  });

  it('丢弃 name/value 缺失的畸形条目，不连累其余', async () => {
    const { webContents } = stubWebContents({
      sendCommand: vi.fn().mockResolvedValue({
        cookies: [{ name: 'ok', value: 'v', domain: '.x.com' }, { value: 'no-name' }, {}],
      }),
    });

    const result = await collectViaCdp(webContents, logger());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cookies).toHaveLength(1);
    expect(result.cookies[0]?.name).toBe('ok');
  });

  it('不调用 Network.enable —— getAllCookies 是即时查询', async () => {
    const { webContents, dbg } = stubWebContents();

    await collectViaCdp(webContents, logger());

    expect(dbg.sendCommand).toHaveBeenCalledExactlyOnceWith('Network.getAllCookies');
  });
});
