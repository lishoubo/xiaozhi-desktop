import { describe, expect, it, vi } from 'vitest';
import { createRmsAuthClient } from '../../../src/main/staff-auth/rms-auth-client';

const ORIGIN = 'http://localhost:8080';

const TOKEN_PAIR = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  accessExpiresInSeconds: 28_800,
  refreshExpiresInSeconds: 604_800,
} as const;

function setup(response: unknown = { code: 0, message: 'ok', data: TOKEN_PAIR }) {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const fetch = vi.fn(async () => new Response(JSON.stringify(response)));
  const client = createRmsAuthClient({
    origin: ORIGIN,
    fetch: fetch as unknown as typeof globalThis.fetch,
    logger,
    appVersion: '1.2.3',
    deviceId: async () => 'device-uuid-1',
    now: vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(17),
    requestIdFactory: () => 'desktop-rms-auth-1',
  });
  return { client, fetch, logger };
}

function headersOf(fetch: ReturnType<typeof vi.fn>): Record<string, string> {
  const init = fetch.mock.calls[0]?.[1] as { headers: Record<string, string> };
  return init.headers;
}

describe('createRmsAuthClient user-agent', () => {
  // rms-server 的 StrictHttpFirewall 只接受 ASCII header 值，而 Electron 默认 UA
  // 里带着中文应用名（"小智酒店管家"），会让请求在进 controller 之前就被拒。
  it('sends an ASCII-only user-agent on login', async () => {
    const { client, fetch } = setup();

    await client.login('staff-1', 'secret');

    // eslint-disable-next-line no-control-regex -- 刻意匹配 ASCII 范围之外的字符。
    expect(headersOf(fetch)['user-agent']).toMatch(/^[\x00-\x7F]+$/);
  });

  it('logs a safe start and completion for the remote call', async () => {
    const { client, logger } = setup();

    await client.login('staff-1', 'secret-password');

    const serialized = JSON.stringify(logger.info.mock.calls);
    expect(serialized).toContain('rms.http.request.started');
    expect(serialized).toContain('rms.http.request.completed');
    expect(serialized).toContain('desktop-rms-auth-1');
    expect(serialized).toContain('"durationMs":7');
    expect(serialized).not.toContain('staff-1');
    expect(serialized).not.toContain('secret-password');
  });

  it('sends an ASCII-only user-agent on every authenticated call', async () => {
    const { client, fetch } = setup({ code: 0, message: 'ok', data: undefined });

    await client.logout('access-1');

    // eslint-disable-next-line no-control-regex -- 刻意匹配 ASCII 范围之外的字符。
    expect(headersOf(fetch)['user-agent']).toMatch(/^[\x00-\x7F]+$/);
    expect(headersOf(fetch).authorization).toBe('Bearer access-1');
  });
});

describe('createRmsAuthClient login fingerprint headers', () => {
  // 服务端 login_log 按这两个头归因。不带也能登录（存 null），所以它们只需
  // 如实透传，不做校验或兜底——但必须挂在所有认证请求上，不止短信接口。
  it('sends the app version and device id on password login', async () => {
    const { client, fetch } = setup();

    await client.login('staff-1', 'secret');

    expect(headersOf(fetch)['x-app-version']).toBe('1.2.3');
    expect(headersOf(fetch)['x-device-id']).toBe('device-uuid-1');
  });

  it('sends them on the phone code request as well', async () => {
    const { client, fetch } = setup({
      code: 0,
      message: 'ok',
      data: { accepted: true, expiresInSeconds: 300, resendAfterSeconds: 60 },
    });

    await client.requestPhoneCode('13800138000');

    expect(headersOf(fetch)['x-app-version']).toBe('1.2.3');
    expect(headersOf(fetch)['x-device-id']).toBe('device-uuid-1');
  });
});

describe('createRmsAuthClient phone authentication', () => {
  const CODE_RESPONSE = { accepted: true, expiresInSeconds: 300, resendAfterSeconds: 60 } as const;

  it('requests a code and returns both durations', async () => {
    const { client, fetch } = setup({ code: 0, message: 'ok', data: CODE_RESPONSE });

    const result = await client.requestPhoneCode('13800138000');

    expect(result).toEqual(CODE_RESPONSE);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, { method: string; body: string }];
    expect(url).toBe(`${ORIGIN}/api/v1/auth/sms/request-code`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ phone: '13800138000' });
  });

  it('rejects a code response that is missing the resend interval', async () => {
    // 少了 resendAfterSeconds 就无从决定按钮倒计时，用 expiresInSeconds 顶替
    // 会把 60s 的间隔算成 300s，所以契约不符必须显式失败而不是猜。
    const { client } = setup({
      code: 0,
      message: 'ok',
      data: { accepted: true, expiresInSeconds: 300 },
    });

    await expect(client.requestPhoneCode('13800138000')).rejects.toMatchObject({
      message: '验证码发送失败，请稍后再试',
    });
  });

  it('surfaces the remote business code when sending is throttled', async () => {
    const { client } = setup({ code: 11009, message: 'too frequent', data: null });

    await expect(client.requestPhoneCode('13800138000')).rejects.toMatchObject({ code: 11009 });
  });

  it('logs in with a phone code and returns the token pair', async () => {
    const { client, fetch } = setup();

    const pair = await client.loginWithPhoneCode('13800138000', '123456');

    expect(pair).toEqual(TOKEN_PAIR);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, { method: string; body: string }];
    expect(url).toBe(`${ORIGIN}/api/v1/auth/sms/login`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ phone: '13800138000', code: '123456' });
  });

  it('surfaces the remote business code when the code is wrong', async () => {
    const { client } = setup({ code: 11010, message: 'bad code', data: null });

    await expect(client.loginWithPhoneCode('13800138000', '000000')).rejects.toMatchObject({
      code: 11010,
    });
  });

  it('never logs the phone number or the verification code', async () => {
    const { client, logger } = setup();

    await client.loginWithPhoneCode('13800138000', '123456');

    const serialized = JSON.stringify([...logger.info.mock.calls, ...logger.warn.mock.calls]);
    expect(serialized).not.toContain('13800138000');
    expect(serialized).not.toContain('123456');
  });
});

describe('staffIdentitySchema 对手机号登录用户的兼容性', () => {
  // 真机联调打到的形状：酒店用户以手机号登录（登录即注册）时尚未绑定酒店，
  // 服务端**不返回 `currentHotelId` 这个 key**。此前 schema 只写了 `nullable()`，
  // 而 nullable 不允许 key 缺失，导致取身份失败、token 被清，
  // 表现为"验证码明明对却回到登录页"。
  it('接受缺少 currentHotelId 的身份响应', async () => {
    const identity = {
      userId: 42,
      username: '13600004089',
      phone: '13600004089',
      userType: 'HOTEL',
      fullName: null,
      role: 'HOTEL_STAFF',
      orgId: 2,
      accessibleHotelIds: [],
      permissions: [],
    };
    const { client } = setup({ code: 0, message: 'ok', data: identity });

    await expect(client.me('access-1')).resolves.toEqual(identity);
  });

  it('仍然接受带 currentHotelId 的服务商员工响应', async () => {
    const identity = {
      userId: 1,
      username: 'admin',
      phone: null,
      userType: 'STAFF',
      fullName: 'Dev Admin',
      role: 'OWNER',
      orgId: 1,
      currentHotelId: 1,
      accessibleHotelIds: [1, 2],
      permissions: ['hotel:view'],
    };
    const { client } = setup({ code: 0, message: 'ok', data: identity });

    await expect(client.me('access-1')).resolves.toEqual(identity);
  });
});
