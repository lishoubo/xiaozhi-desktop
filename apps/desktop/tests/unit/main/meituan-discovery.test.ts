import { describe, expect, it, vi } from 'vitest';
import { createMeituanDiscovery } from '../../../src/main/channels/meituan/discovery';

function logger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('createMeituanDiscovery', () => {
  it('直接在当前可信美团页面读取账号身份', async () => {
    const executeJavaScript = vi.fn().mockResolvedValueOnce({
      kind: 'completed',
      candidates: [
        {
          candidateAccountId: '274615733',
          response: {
            code: 10000,
            data: { bizAcctId: '274615733', partnerId: '4595635' },
          },
        },
      ],
    });
    const webContents = {
      getURL: vi.fn(() => 'https://me.meituan.com/ebooking/index.html'),
      executeJavaScript,
    };

    await expect(
      createMeituanDiscovery(logger())(
        'persist:xiaozhi:prod:meituan:one',
        'https://me.meituan.com/ebooking/index.html',
        webContents as never,
      ),
    ).resolves.toEqual({
      kind: 'found',
      credential: {
        channelAccountId: '274615733',
        credentialExtra: {
          partnerId: '4595635',
          login: null,
          accountType: null,
          accountStatus: null,
          maskedPhone: null,
        },
      },
    });
    expect(executeJavaScript).toHaveBeenCalledTimes(1);
  });

  it('即使 landingUrl 可信，当前页面不是美团域时也拒绝执行', async () => {
    const executeJavaScript = vi.fn();
    const webContents = {
      getURL: vi.fn(() => 'https://example.com/ebooking/index.html'),
      executeJavaScript,
    };

    await expect(
      createMeituanDiscovery(logger())(
        'persist:xiaozhi:prod:meituan:one',
        'https://me.meituan.com/ebooking/index.html',
        webContents as never,
      ),
    ).resolves.toEqual({ kind: 'none' });
    expect(executeJavaScript).not.toHaveBeenCalled();
  });
});
