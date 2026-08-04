import { describe, expect, it, vi } from 'vitest';
import { toChannelId } from '../../../src/domain/identity';
import { LoginTabOpener } from '../../../src/main/features/ota-account/login-tab-opener';

function tempUserDataDir(): string {
  return `/tmp/xiaozhi-login-tab-opener-test-${Math.random().toString(36).slice(2)}`;
}

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
});
