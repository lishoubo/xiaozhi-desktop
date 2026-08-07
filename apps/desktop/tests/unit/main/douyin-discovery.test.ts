import type { WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { createDouyinDiscovery } from '../../../src/main/features/ota-credential/ota/douyin/discover-douyin';

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
});
