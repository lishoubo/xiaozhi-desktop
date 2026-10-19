import { describe, expect, it, vi } from 'vitest';
import { createMeituanDiscovery } from '../../../src/main/channels/meituan/discovery';

const partition = 'persist:xiaozhi:prod:meituan:one';
const url = 'https://me.meituan.com/ebooking/index.html';
const account = '274615733';
const detail = { code: 10000, data: { bizAcctId: account, partnerId: '4595635' } };
const pois = {
  code: 10000,
  data: {
    twoLevelList: [{ poiList: [{ poiId: 1834077877, poiName: '苏州平江府', partnerId: 4595635 }] }],
  },
};

function setup(
  responses: readonly { ok: boolean; body?: unknown }[],
  candidates: unknown = [account],
) {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const fetch = vi.fn(async (_partitionName: string, _url: string, _options: RequestInit) => {
    const response = responses[fetch.mock.calls.length - 1];
    return { ok: response.ok, json: async () => response.body } as Response;
  });
  const webContents = {
    getURL: vi.fn(() => url),
    isDestroyed: vi.fn(() => false),
    executeJavaScript: vi.fn(async () => candidates),
  };
  const discover = createMeituanDiscovery(logger, fetch);
  return { logger, fetch, webContents, discover };
}

describe('createMeituanDiscovery', () => {
  it('选中账号只请求该 ID 的详情，并在主进程读取门店', async () => {
    const s = setup([
      { ok: true, body: detail },
      { ok: true, body: pois },
    ]);
    const result = await s.discover(partition, url, s.webContents as never, {
      expectedChannelAccountId: account,
      freshPartition: false,
    });
    expect(result).toEqual({
      kind: 'found',
      credential: {
        channelAccountId: account,
        credentialExtra: {
          partnerId: '4595635',
          login: null,
          accountType: null,
          accountStatus: null,
          maskedPhone: null,
          pois: [{ poiId: '1834077877', otaPartnerId: '4595635', poiName: '苏州平江府' }],
        },
      },
    });
    expect(s.fetch).toHaveBeenCalledTimes(2);
    expect(s.fetch.mock.calls[0][1]).toContain(`beQueriedAccountId=${account}`);
    expect(s.webContents.executeJavaScript).not.toHaveBeenCalled();
  });

  it('旧账号失效时只作一次有限的主进程请求', async () => {
    const s = setup([{ ok: false }], ['old', 'another']);
    await expect(
      s.discover(partition, url, s.webContents as never, {
        expectedChannelAccountId: account,
        freshPartition: false,
      }),
    ).resolves.toEqual({ kind: 'none' });
    expect(s.fetch).toHaveBeenCalledTimes(1);
    expect(s.webContents.executeJavaScript).not.toHaveBeenCalled();
  });

  it('新 partition 无 ID 时先验证会话，再用唯一线索请求一次详情', async () => {
    const s = setup([
      { ok: true, body: pois },
      { ok: true, body: detail },
    ]);
    const result = await s.discover(partition, url, s.webContents as never, {
      freshPartition: true,
    });
    expect(result.kind).toBe('found');
    expect(s.fetch).toHaveBeenCalledTimes(2);
    expect(s.fetch.mock.calls[0][1]).toContain('poiInfos');
    expect(s.webContents.executeJavaScript).toHaveBeenCalledTimes(1);
  });

  it('多候选不遍历；旧 partition 无 ID 不使用历史线索', async () => {
    const s = setup([{ ok: true, body: pois }], ['old', 'new']);
    await expect(
      s.discover(partition, url, s.webContents as never, { freshPartition: true }),
    ).resolves.toEqual({ kind: 'identity-unavailable' });
    expect(s.fetch).toHaveBeenCalledTimes(1);
    const old = setup([]);
    await expect(
      old.discover(partition, url, old.webContents as never, { freshPartition: false }),
    ).resolves.toEqual({ kind: 'identity-unavailable' });
    expect(old.fetch).not.toHaveBeenCalled();
  });

  it('旧 partition 只有经历登录页且出现唯一新线索才可识别', async () => {
    const s = setup([
      { ok: true, body: pois },
      { ok: true, body: detail },
    ]);
    s.webContents.executeJavaScript
      .mockResolvedValueOnce(['old-account'])
      .mockResolvedValueOnce(['old-account', account]);
    const identityClues = {
      baseline: null as readonly string[] | null,
      sawLoginPage: false,
      switchToFreshDiscovery: false,
    };
    const context = { freshPartition: false, identityClues };
    await expect(s.discover(partition, url, s.webContents as never, context)).resolves.toEqual({
      kind: 'none',
    });
    expect(identityClues.baseline).toEqual(['old-account']);
    expect(s.fetch).not.toHaveBeenCalled();
    identityClues.sawLoginPage = true;
    const result = await s.discover(partition, url, s.webContents as never, context);
    expect(result.kind).toBe('found');
    expect(s.fetch).toHaveBeenCalledTimes(2);
    expect(s.fetch.mock.calls[1][1]).toContain(`beQueriedAccountId=${account}`);
  });

  it('首个事件就是登录页时等待基线读取，再确认新账号', async () => {
    const s = setup([
      { ok: true, body: pois },
      { ok: true, body: detail },
    ]);
    const identityClues = {
      baseline: null as readonly string[] | null,
      sawLoginPage: true,
      switchToFreshDiscovery: false,
      baselinePending: Promise.resolve(),
    };
    identityClues.baselinePending = Promise.resolve().then(() => {
      identityClues.baseline = [];
    });
    const result = await s.discover(partition, url, s.webContents as never, {
      freshPartition: false,
      identityClues,
    });
    expect(result.kind).toBe('found');
    expect(s.fetch).toHaveBeenCalledTimes(2);
  });

  it('普通标签重新登录后不再沿用原账号提示', async () => {
    const nextId = 'new-account';
    const s = setup(
      [
        { ok: true, body: pois },
        { ok: true, body: { code: 10000, data: { bizAcctId: nextId } } },
      ],
      [account, nextId],
    );
    const result = await s.discover(partition, url, s.webContents as never, {
      expectedChannelAccountId: account,
      freshPartition: false,
      identityClues: { baseline: [account], sawLoginPage: true, switchToFreshDiscovery: true },
    });
    expect(result.kind).toBe('found');
    if (result.kind === 'found') expect(result.credential.channelAccountId).toBe(nextId);
    expect(s.fetch.mock.calls[1][1]).toContain(`beQueriedAccountId=${nextId}`);
  });

  it('账号详情不匹配或页面离开时不交付身份', async () => {
    const mismatch = setup([{ ok: true, body: { code: 10000, data: { bizAcctId: 'other' } } }]);
    await expect(
      mismatch.discover(partition, url, mismatch.webContents as never, {
        expectedChannelAccountId: account,
        freshPartition: false,
      }),
    ).resolves.toEqual({ kind: 'none' });
    const stale = setup([{ ok: true, body: detail }]);
    stale.webContents.getURL
      .mockReturnValueOnce(url)
      .mockReturnValue('https://me.meituan.com/login/index.html');
    await expect(
      stale.discover(partition, url, stale.webContents as never, {
        expectedChannelAccountId: account,
        freshPartition: false,
        isCurrent: () => false,
      }),
    ).resolves.toEqual({ kind: 'none' });
    expect(stale.fetch).not.toHaveBeenCalled();
  });

  it('详情请求超时后返回未确认，并终止请求', async () => {
    vi.useFakeTimers();
    try {
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const fetch = vi.fn(
        async (_partitionName: string, _url: string, _options: RequestInit) =>
          new Promise<Response>(() => undefined),
      );
      const webContents = {
        getURL: () => url,
        isDestroyed: () => false,
        executeJavaScript: vi.fn(),
      };
      const pending = createMeituanDiscovery(logger, fetch)(partition, url, webContents as never, {
        expectedChannelAccountId: account,
        freshPartition: false,
      });
      await vi.advanceTimersByTimeAsync(5000);
      await expect(pending).resolves.toEqual({ kind: 'none' });
      const options = fetch.mock.calls[0][2];
      expect(options.signal?.aborted).toBe(true);
      expect(webContents.executeJavaScript).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
