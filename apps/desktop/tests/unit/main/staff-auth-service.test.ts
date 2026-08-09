import { describe, expect, it, vi } from 'vitest';
import { StaffAuthService } from '../../../src/main/services/staff-auth-service';
import { RMS_ERROR, RmsAuthError } from '../../../src/main/staff-auth/rms-auth-errors';
import { RmsSessionMissingError } from '../../../src/main/staff-auth/rms-token-provider';

const IDENTITY = {
  userId: 1,
  username: 'admin',
  fullName: 'Dev Admin',
  role: 'OWNER',
  orgId: 1,
  currentHotelId: null,
  accessibleHotelIds: [],
  permissions: [],
} as const;

function setup(
  overrides: {
    me?: ReturnType<typeof vi.fn>;
    accessToken?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const client = {
    login: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(async () => undefined),
    me: overrides.me ?? vi.fn(async () => IDENTITY),
  };
  const tokens = {
    accessToken: overrides.accessToken ?? vi.fn(async () => 'access-1'),
    invalidate: vi.fn(),
    adopt: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
  };
  const service = new StaffAuthService({ client: client as never, tokens, logger });
  return { service, client, tokens };
}

describe('StaffAuthService.currentSession', () => {
  it('returns the identity for a healthy session', async () => {
    const { service } = setup();

    await expect(service.currentSession()).resolves.toEqual(IDENTITY);
  });

  it('reports no session when nothing is stored', async () => {
    const accessToken = vi.fn(async () => {
      throw new RmsSessionMissingError();
    });
    const { service } = setup({ accessToken });

    await expect(service.currentSession()).resolves.toBeNull();
  });

  it('retries with a fresh token when the server rejects the current one', async () => {
    // 本地算出的过期时间可能与服务端不同步（时钟偏移、服务端主动吊销）。
    // 此时盘上的 refresh token 往往仍然可用，不该直接把用户踢回登录页。
    const me = vi
      .fn()
      .mockRejectedValueOnce(new RmsAuthError(RMS_ERROR.tokenExpired, 'token 已过期'))
      .mockResolvedValueOnce(IDENTITY);
    const { service, tokens } = setup({ me });

    await expect(service.currentSession()).resolves.toEqual(IDENTITY);
    expect(tokens.invalidate).toHaveBeenCalledOnce();
    expect(me).toHaveBeenCalledTimes(2);
  });

  it('gives up and clears the session when the retry is rejected too', async () => {
    const me = vi.fn(async () => {
      throw new RmsAuthError(RMS_ERROR.tokenInvalid, 'token 无效');
    });
    const { service, tokens } = setup({ me });

    await expect(service.currentSession()).resolves.toBeNull();
    expect(me).toHaveBeenCalledTimes(2);
    expect(tokens.clear).toHaveBeenCalledOnce();
  });

  it('surfaces a transient failure instead of silently signing the user out', async () => {
    // 网络抖动不是"登录失效"——误判会白白清掉一个有效的登录态。
    const me = vi.fn(async () => {
      throw new Error('network down');
    });
    const { service, tokens } = setup({ me });

    await expect(service.currentSession()).rejects.toThrow('无法验证登录状态，请重试');
    expect(tokens.clear).not.toHaveBeenCalled();
  });
});
