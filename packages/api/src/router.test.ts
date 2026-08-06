import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { appRouter } from './router';

describe('appRouter', () => {
  const activeEmployee = {
    id: '9007199254740993',
    orgId: '42',
    username: 'front-desk-1',
    fullName: '测试员工',
    phone: '13800138000',
    roleCode: 'FRONT_DESK',
  } as const;

  function createCaller({
    findActiveByPhone = vi.fn().mockResolvedValue(null),
    requestCode = vi.fn().mockResolvedValue({ expiresInSeconds: 300 }),
    verifyCode = vi.fn().mockResolvedValue(true),
    logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  } = {}) {
    return appRouter.createCaller({
      employeeDirectory: { findActiveByPhone },
      phoneOtp: { requestCode, verifyCode },
      logger,
      requestId: 'request-123',
    });
  }

  it('reports the server transport as healthy', async () => {
    const debug = vi.fn();
    const caller = appRouter.createCaller({
      employeeDirectory: { findActiveByPhone: vi.fn().mockResolvedValue(null) },
      phoneOtp: {
        requestCode: vi.fn().mockResolvedValue({ expiresInSeconds: 300 }),
        verifyCode: vi.fn().mockResolvedValue(true),
      },
      logger: {
        debug,
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      requestId: 'request-123',
    });

    await expect(caller.system.health()).resolves.toEqual({ status: 'ok' });
    expect(debug).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'trpc.procedure.completed',
        procedure: 'system.health',
        procedureType: 'query',
        requestId: 'request-123',
      }),
      'tRPC procedure completed',
    );
    expect(JSON.stringify(debug.mock.calls)).not.toContain('input');
  });

  it('accepts a phone-code request without consulting the employee directory', async () => {
    const findActiveByPhone = vi.fn().mockResolvedValue(null);
    const requestCode = vi.fn().mockResolvedValue({ expiresInSeconds: 300 });
    const caller = createCaller({ findActiveByPhone, requestCode });

    await expect(caller.auth.requestPhoneCode({ phone: '13800138000' })).resolves.toEqual({
      accepted: true,
      expiresInSeconds: 300,
    });
    expect(requestCode).toHaveBeenCalledWith('13800138000');
    expect(findActiveByPhone).not.toHaveBeenCalled();
  });

  it('returns a safe active RMS employee identity after OTP verification', async () => {
    const findActiveByPhone = vi.fn().mockResolvedValue(activeEmployee);
    const verifyCode = vi.fn().mockResolvedValue(true);
    const caller = createCaller({ findActiveByPhone, verifyCode });

    await expect(
      caller.auth.loginWithPhoneCode({ phone: '13800138000', code: '654321' }),
    ).resolves.toEqual(activeEmployee);
    expect(verifyCode).toHaveBeenCalledWith('13800138000', '654321');
    expect(findActiveByPhone).toHaveBeenCalledWith('13800138000');
    expect(JSON.stringify(activeEmployee)).not.toContain('password');
  });

  it('uses the same unauthenticated failure for a rejected code and unavailable employee', async () => {
    const rejectedCodeDirectory = vi.fn().mockResolvedValue(activeEmployee);
    const rejectedCodeCaller = createCaller({
      findActiveByPhone: rejectedCodeDirectory,
      verifyCode: vi.fn().mockResolvedValue(false),
    });
    const unavailableEmployeeCaller = createCaller();

    await expect(
      rejectedCodeCaller.auth.loginWithPhoneCode({ phone: '13800138000', code: '654321' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED', message: '手机号或验证码不正确' });
    expect(rejectedCodeDirectory).not.toHaveBeenCalled();
    await expect(
      unavailableEmployeeCaller.auth.loginWithPhoneCode({
        phone: '13900139000',
        code: '654321',
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED', message: '手机号或验证码不正确' });
  });

  it('rejects malformed inputs and does not expose a direct identity router', async () => {
    const caller = createCaller();

    await expect(caller.auth.requestPhoneCode({ phone: 'employee-1' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(
      caller.auth.loginWithPhoneCode({ phone: '13800138000', code: '12345' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect('identity' in caller).toBe(false);
  });

  it('does not include auth inputs in successful procedure logs', async () => {
    const info = vi.fn();
    const caller = createCaller({
      findActiveByPhone: vi.fn().mockResolvedValue(activeEmployee),
      logger: { debug: vi.fn(), info, warn: vi.fn(), error: vi.fn() },
    });

    await caller.auth.requestPhoneCode({ phone: '13800138000' });
    await caller.auth.loginWithPhoneCode({ phone: '13800138000', code: '654321' });

    expect(info).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(info.mock.calls)).not.toContain('13800138000');
    expect(JSON.stringify(info.mock.calls)).not.toContain('654321');
  });

  it('converts gateway and employee-directory failures to safe server errors', async () => {
    const gatewayFailure = new Error('provider rejected phone 13800138000');
    const directoryFailure = new Error('database failed for 13900139000');
    const requestCaller = createCaller({
      requestCode: vi.fn().mockRejectedValue(gatewayFailure),
    });
    const loginCaller = createCaller({
      findActiveByPhone: vi.fn().mockRejectedValue(directoryFailure),
    });

    await expect(
      requestCaller.auth.requestPhoneCode({ phone: '13800138000' }),
    ).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: '验证码服务暂时不可用，请稍后重试',
      cause: gatewayFailure,
    });
    await expect(
      loginCaller.auth.loginWithPhoneCode({ phone: '13900139000', code: '654321' }),
    ).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: '登录服务暂时不可用，请稍后重试',
      cause: directoryFailure,
    });
  });
});
