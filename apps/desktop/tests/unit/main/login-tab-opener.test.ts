import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toChannelId } from '../../../src/domain/identity';
import { LoginTabOpener } from '../../../src/main/features/ota-account/login-tab-opener';
import { readImportedCookies, writeImportedCookies } from '../../../src/main/cookie-import/store';

const temporaryDirectories: string[] = [];

function tempUserDataDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaozhi-login-tab-opener-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe('LoginTabOpener', () => {
  it('把该渠道的 loginUrlMatcher 和 onUrlPastLogin 回调传给 createAndNewPartition', async () => {
    const channel = toChannelId('ctrip');
    const matcher = { channel, isPastLogin: (url: string) => !url.includes('/login/') };
    const triggerDiscovery = vi.fn();
    const createAndNewPartition = vi.fn().mockResolvedValue({
      tab: { id: 'tab-1' },
      partitionName: 'persist:xiaozhi:prod:ctrip:aaa',
    });

    const opener = new LoginTabOpener({
      userDataDir: tempUserDataDir(),
      browser: { createAndNewPartition },
      loginUrlMatchers: new Map([[channel, matcher]]),
      triggerDiscovery,
    });

    await opener.open('prod', channel, 'https://ebooking.ctrip.com/login/');

    expect(createAndNewPartition).toHaveBeenCalledOnce();
    const options = createAndNewPartition.mock.calls[0][3];
    expect(options.loginUrlMatcher).toBe(matcher);
    expect(typeof options.onUrlPastLogin).toBe('function');

    const webContents = {} as never;
    options.onUrlPastLogin('persist:xiaozhi:prod:ctrip:aaa', 'https://ebooking.ctrip.com/hotel/12345', webContents);
    expect(triggerDiscovery).toHaveBeenCalledExactlyOnceWith(
      'persist:xiaozhi:prod:ctrip:aaa',
      channel,
      'https://ebooking.ctrip.com/hotel/12345',
      webContents,
    );
  });

  it('渠道未注册 loginUrlMatcher 时，传给 createAndNewPartition 的 matcher 是 undefined', async () => {
    const channel = toChannelId('douyin');
    const createAndNewPartition = vi.fn().mockResolvedValue({
      tab: { id: 'tab-1' },
      partitionName: 'persist:xiaozhi:prod:douyin:bbb',
    });

    const opener = new LoginTabOpener({
      userDataDir: tempUserDataDir(),
      browser: { createAndNewPartition },
      loginUrlMatchers: new Map(),
      triggerDiscovery: vi.fn(),
    });

    await opener.open('prod', channel, 'https://life.douyin.com/p/login');

    const options = createAndNewPartition.mock.calls[0][3];
    expect(options.loginUrlMatcher).toBeUndefined();
  });

  describe('createFromCookie', () => {
    it('没有已导入 cookie 时拒绝', async () => {
      const channel = toChannelId('ctrip');
      const opener = new LoginTabOpener({
        userDataDir: tempUserDataDir(),
        browser: { createAndNewPartition: vi.fn() },
        loginUrlMatchers: new Map(),
        triggerDiscovery: vi.fn(),
      });

      await expect(opener.createFromCookie('prod', channel, 'https://ebooking.ctrip.com/')).rejects.toThrow(
        '该渠道尚未导入 Cookie',
      );
    });

    it('携程：注入 cookie，页面加载完成后静默触发探测，成功后不删除该渠道 cookie（允许反复登录）', async () => {
      const channel = toChannelId('ctrip');
      const userDataDir = tempUserDataDir();
      await writeImportedCookies(userDataDir, channel, [{ name: 'a', value: '1' } as never], {
        importedAt: '2026-08-04T00:00:00.000Z',
        sourceId: 'chrome',
      });
      const triggerDiscovery = vi.fn().mockResolvedValue(true);
      const createAndNewPartition = vi.fn().mockResolvedValue({
        tab: { id: 'tab-1' },
        partitionName: 'persist:xiaozhi:prod:ctrip:aaa',
      });

      const opener = new LoginTabOpener({
        userDataDir,
        browser: { createAndNewPartition },
        loginUrlMatchers: new Map(),
        triggerDiscovery,
      });

      await opener.createFromCookie('prod', channel, 'https://ebooking.ctrip.com/');

      const options = createAndNewPartition.mock.calls[0][3];
      expect(options.importedCookies).toEqual([{ name: 'a', value: '1' }]);
      expect(options.onUrlPastLogin).toBeUndefined();
      expect(typeof options.onLoadFinished).toBe('function');

      const webContents = {} as never;
      options.onLoadFinished(
        'persist:xiaozhi:prod:ctrip:aaa',
        'https://ebooking.ctrip.com/home/mainland',
        webContents,
      );
      // `onLoadFinished` 内部用 `void triggerDiscovery(...)` 触发，不等待其完成——
      // 用一次微任务队列刷新等待 mock 的 resolved promise 落地。
      await Promise.resolve();

      expect(triggerDiscovery).toHaveBeenCalledExactlyOnceWith(
        'persist:xiaozhi:prod:ctrip:aaa',
        channel,
        'https://ebooking.ctrip.com/home/mainland',
        webContents,
      );
      await expect(readImportedCookies(userDataDir, channel)).resolves.not.toBeNull();
    });

    it('抖音：注入 cookie，挂 onUrlPastLogin/loginUrlMatcher，不删除 cookie', async () => {
      const channel = toChannelId('douyin');
      const userDataDir = tempUserDataDir();
      await writeImportedCookies(userDataDir, channel, [{ name: 'sid', value: 'x' } as never], {
        importedAt: '2026-08-04T00:00:00.000Z',
        sourceId: 'chrome',
      });
      const matcher = { channel, isPastLogin: (url: string) => url.includes('groupid=') };
      const triggerDiscovery = vi.fn().mockResolvedValue(true);
      const createAndNewPartition = vi.fn().mockResolvedValue({
        tab: { id: 'tab-1' },
        partitionName: 'persist:xiaozhi:prod:douyin:bbb',
      });

      const opener = new LoginTabOpener({
        userDataDir,
        browser: { createAndNewPartition },
        loginUrlMatchers: new Map([[channel, matcher]]),
        triggerDiscovery,
      });

      await opener.createFromCookie('prod', channel, 'https://life.douyin.com/p/login');

      const options = createAndNewPartition.mock.calls[0][3];
      expect(options.importedCookies).toEqual([{ name: 'sid', value: 'x' }]);
      expect(options.loginUrlMatcher).toBe(matcher);
      expect(options.onLoadFinished).toBeUndefined();
      expect(typeof options.onUrlPastLogin).toBe('function');
    });
  });
});
