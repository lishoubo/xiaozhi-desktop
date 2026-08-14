import type { WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { createDouyinDiscovery } from '../../../src/main/channels/douyin/discovery';

describe('createDouyinDiscovery', () => {
  it('当前 View 不是受信任抖音来客页面时不读取 Session Storage', async () => {
    const executeJavaScript = vi.fn();
    const webContents = {
      getURL: vi.fn(() => 'https://life.douyin.com.evil.example/p/home?groupid=fake'),
      executeJavaScript,
    } as unknown as WebContents;
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const discover = createDouyinDiscovery(logger);

    await expect(
      discover(
        'persist:xiaozhi:prod:douyin:test',
        'https://life.douyin.com/p/home?groupid=stale',
        webContents,
      ),
    ).resolves.toEqual({ kind: 'none' });

    expect(executeJavaScript).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('Douyin discovery rejected untrusted current URL');
  });

  /**
   * 身份晚一点才写进 session storage 是常态（原先 5s 上限就是偶发失败的来源）。
   * 这里锁住的是「等待期间空值不算失败」，不断言具体轮数——超时值可以调，
   * 「等到了就成功」的语义不能变。
   */
  it('身份延迟写入 session storage 时继续等待，不提前判失败', async () => {
    vi.useFakeTimers();
    try {
      const identity = {
        user_id: '123',
        login_id: 'shop-1',
        name: '小猪门店',
        role_name: '管理员',
        role_type: 1,
      };
      let calls = 0;
      const executeJavaScript = vi.fn(async () => {
        calls += 1;
        return calls < 8 ? null : identity;
      });
      const webContents = {
        getURL: vi.fn(() => 'https://life.douyin.com/p/home?groupid=g1'),
        executeJavaScript,
      } as unknown as WebContents;
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

      const pending = createDouyinDiscovery(logger)(
        'persist:xiaozhi:prod:douyin:test',
        'https://life.douyin.com/p/home',
        webContents,
      );
      await vi.runAllTimersAsync();

      expect(await pending).toEqual({
        kind: 'found',
        credential: expect.objectContaining({ channelAccountId: '123' }),
      });
      expect(logger.warn).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  /** 超时与「读到了但解析不出」必须记成两句不同的 warn，否则真机排查分不出该等还是该改解析。 */
  it('一直读不到身份时按超时记录，与解析失败区分开', async () => {
    vi.useFakeTimers();
    try {
      const webContents = {
        getURL: vi.fn(() => 'https://life.douyin.com/p/home?groupid=g1'),
        executeJavaScript: vi.fn(async () => null),
      } as unknown as WebContents;
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

      const pending = createDouyinDiscovery(logger)(
        'persist:xiaozhi:prod:douyin:test',
        'https://life.douyin.com/p/home',
        webContents,
      );
      await vi.runAllTimersAsync();

      expect(await pending).toEqual({ kind: 'none' });
      expect(logger.warn).toHaveBeenCalledWith(
        'Douyin discovery: session storage held no account identity before timeout',
        expect.objectContaining({ partitionName: 'persist:xiaozhi:prod:douyin:test' }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('读到了内容但解析不出时记成解析失败，不记成超时', async () => {
    vi.useFakeTimers();
    try {
      const webContents = {
        getURL: vi.fn(() => 'https://life.douyin.com/p/home?groupid=g1'),
        executeJavaScript: vi.fn(async () => ({ unexpected: 'shape' })),
      } as unknown as WebContents;
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

      const pending = createDouyinDiscovery(logger)(
        'persist:xiaozhi:prod:douyin:test',
        'https://life.douyin.com/p/home',
        webContents,
      );
      await vi.runAllTimersAsync();

      expect(await pending).toEqual({ kind: 'none' });
      expect(logger.warn).toHaveBeenCalledWith(
        'Douyin discovery: account identity in session storage could not be parsed',
        expect.objectContaining({ partitionName: 'persist:xiaozhi:prod:douyin:test' }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
