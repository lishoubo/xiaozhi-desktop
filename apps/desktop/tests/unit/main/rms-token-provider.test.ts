import { describe, expect, it, vi } from 'vitest';
import { createRmsTokenProvider } from '../../../src/main/staff-auth/rms-token-provider';
import { RmsAuthError, RMS_ERROR } from '../../../src/main/staff-auth/rms-auth-errors';
import type { StoredStaffTokens } from '../../../src/main/staff-auth/token-store';

const NOW = 1_000_000;
const HOUR = 3_600_000;

function tokens(overrides: Partial<StoredStaffTokens> = {}): StoredStaffTokens {
  return {
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    accessExpiresAt: NOW + HOUR,
    refreshExpiresAt: NOW + 24 * HOUR,
    ...overrides,
  };
}

function setup(
  overrides: {
    stored?: StoredStaffTokens | null;
    refresh?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const store = {
    read: vi.fn(async () => ('stored' in overrides ? (overrides.stored ?? null) : tokens())),
    write: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
  };
  const client = {
    refresh:
      overrides.refresh ??
      vi.fn(async () => ({
        accessToken: 'access-2',
        refreshToken: 'refresh-2',
        accessExpiresInSeconds: 3600,
        refreshExpiresInSeconds: 86_400,
      })),
  };
  const provider = createRmsTokenProvider({
    tokenStore: store,
    client: client as never,
    now: () => NOW,
    logger,
  });
  return { provider, store, client, logger };
}

describe('createRmsTokenProvider', () => {
  it('returns the stored access token while it is still valid', async () => {
    const { provider, client } = setup();

    expect(await provider.accessToken()).toBe('access-1');
    expect(client.refresh).not.toHaveBeenCalled();
  });

  it('refreshes before the access token expires rather than after it fails', async () => {
    // 卡在过期点上发出的请求，到达服务端时可能刚好越线——所以带 skew 提前刷。
    const { provider, client, store } = setup({ stored: tokens({ accessExpiresAt: NOW + 1000 }) });

    expect(await provider.accessToken()).toBe('access-2');
    expect(client.refresh).toHaveBeenCalledWith('refresh-1');
    expect(store.write).toHaveBeenCalledOnce();
  });

  it('deduplicates concurrent refreshes into a single call', async () => {
    const { provider, client } = setup({ stored: tokens({ accessExpiresAt: NOW - 1 }) });

    const [first, second] = await Promise.all([provider.accessToken(), provider.accessToken()]);

    expect(first).toBe('access-2');
    expect(second).toBe('access-2');
    expect(client.refresh).toHaveBeenCalledOnce();
  });

  it('throws without clearing the session when the refresh token is rejected', async () => {
    const refresh = vi.fn(async () => {
      throw new RmsAuthError(RMS_ERROR.refreshTokenInvalid, '登录已过期');
    });
    const { provider, store } = setup({ stored: tokens({ accessExpiresAt: NOW - 1 }), refresh });

    await expect(provider.accessToken()).rejects.toThrow();
    // 刻意不清本地凭证：登出与否由调用方决定，认证层只报错。
    expect(store.clear).not.toHaveBeenCalled();
  });

  it('throws when there is no stored session at all', async () => {
    const { provider } = setup({ stored: null });

    await expect(provider.accessToken()).rejects.toThrow();
  });

  it('exchanges the rejected token for a new one instead of re-reading the same value', async () => {
    // 服务端不认当前 token 时，光丢掉内存缓存没用——盘上那份还没过期，
    // 会被原样读回来再发一次，重试必然又是 401。
    const { provider, client } = setup();

    expect(await provider.accessToken()).toBe('access-1');
    provider.invalidate();

    expect(await provider.accessToken()).toBe('access-2');
    expect(client.refresh).toHaveBeenCalledOnce();
  });

  it('clears the stored credentials once the refresh token itself has expired', async () => {
    // 不清理的话，这对死凭证会永久留在盘上，之后每次调用都白读一次。
    const { provider, store } = setup({
      stored: tokens({ accessExpiresAt: NOW - 1, refreshExpiresAt: NOW - 1 }),
    });

    await expect(provider.accessToken()).rejects.toThrow();
    expect(store.clear).toHaveBeenCalledOnce();
  });

  it('does not refresh twice with a refresh token the first call already consumed', async () => {
    // RMS 的 refresh token 单次使用。第二个调用方若在 inFlightRefresh 清空后才
    // 进来、却仍持有旧的 current，就会拿着已作废的 token 再刷一次并被拒。
    const { provider, client } = setup({ stored: tokens({ accessExpiresAt: NOW - 1 }) });

    const first = await provider.accessToken();
    const second = await provider.accessToken();

    expect(first).toBe('access-2');
    expect(second).toBe('access-2');
    expect(client.refresh).toHaveBeenCalledOnce();
    expect(client.refresh).toHaveBeenCalledWith('refresh-1');
  });
});
