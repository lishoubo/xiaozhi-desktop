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
    currentEmployee = vi.fn().mockResolvedValue(null),
    issue = vi.fn().mockResolvedValue(undefined),
    revoke = vi.fn().mockResolvedValue(undefined),
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
      employeeDirectory: { findActiveById: vi.fn().mockResolvedValue(null), findActiveByPhone },
      desktopSession: { currentEmployee, issue, revoke },
      phoneOtp: { requestCode, verifyCode },
      logger,
      requestId: 'request-123',
    });
  }

  it('reports the server transport as healthy', async () => {
    const debug = vi.fn();
    const caller = appRouter.createCaller({
      employeeDirectory: {
        findActiveById: vi.fn().mockResolvedValue(null),
        findActiveByPhone: vi.fn().mockResolvedValue(null),
      },
      desktopSession: {
        currentEmployee: vi.fn().mockResolvedValue(null),
        issue: vi.fn().mockResolvedValue(undefined),
        revoke: vi.fn().mockResolvedValue(undefined),
      },
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
    const currentEmployee = vi.fn().mockRejectedValue(new Error('session must not be consulted'));
    const requestCode = vi.fn().mockResolvedValue({ expiresInSeconds: 300 });
    const caller = createCaller({ currentEmployee, findActiveByPhone, requestCode });

    await expect(caller.auth.requestPhoneCode({ phone: '13800138000' })).resolves.toEqual({
      accepted: true,
      expiresInSeconds: 300,
    });
    expect(requestCode).toHaveBeenCalledWith('13800138000');
    expect(currentEmployee).not.toHaveBeenCalled();
    expect(findActiveByPhone).not.toHaveBeenCalled();
  });

  it('returns a safe active RMS employee identity after OTP verification', async () => {
    const findActiveByPhone = vi.fn().mockResolvedValue(activeEmployee);
    const issue = vi.fn().mockResolvedValue(undefined);
    const verifyCode = vi.fn().mockResolvedValue(true);
    const caller = createCaller({ findActiveByPhone, issue, verifyCode });

    await expect(
      caller.auth.loginWithPhoneCode({ phone: '13800138000', code: '654321' }),
    ).resolves.toEqual(activeEmployee);
    expect(verifyCode).toHaveBeenCalledWith('13800138000', '654321');
    expect(findActiveByPhone).toHaveBeenCalledWith('13800138000');
    expect(issue).toHaveBeenCalledWith(activeEmployee);
    expect(JSON.stringify(activeEmployee)).not.toContain('password');
  });

  it('restores the current employee and returns null without a valid session', async () => {
    const currentEmployee = vi
      .fn()
      .mockResolvedValueOnce(activeEmployee)
      .mockResolvedValueOnce(null);
    const caller = createCaller({ currentEmployee });

    await expect(caller.auth.currentSession()).resolves.toEqual(activeEmployee);
    await expect(caller.auth.currentSession()).resolves.toBeNull();
    expect(currentEmployee).toHaveBeenCalledTimes(2);
  });

  it('revokes the current desktop session on logout', async () => {
    const revoke = vi.fn().mockResolvedValue(undefined);
    const currentEmployee = vi.fn().mockResolvedValue(activeEmployee);
    const caller = createCaller({ currentEmployee, revoke });

    await expect(caller.auth.logout()).resolves.toEqual({ success: true });
    expect(currentEmployee).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledOnce();
  });

  it('rejects protected procedures without a desktop session', async () => {
    const revoke = vi.fn().mockResolvedValue(undefined);
    const caller = createCaller({ revoke });

    await expect(caller.auth.logout()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: '请先登录',
    });
    expect(revoke).not.toHaveBeenCalled();
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

  it('converts desktop-session failures to fixed public messages', async () => {
    const issueFailure = new Error('token=raw-login-token');
    const currentFailure = new Error('cookie=raw-session-cookie');
    const revokeFailure = new Error('digest=private-session-digest');
    const loginCaller = createCaller({
      findActiveByPhone: vi.fn().mockResolvedValue(activeEmployee),
      issue: vi.fn().mockRejectedValue(issueFailure),
    });
    const currentCaller = createCaller({
      currentEmployee: vi.fn().mockRejectedValue(currentFailure),
    });
    const logoutCaller = createCaller({
      currentEmployee: vi.fn().mockResolvedValue(activeEmployee),
      revoke: vi.fn().mockRejectedValue(revokeFailure),
    });

    await expect(
      loginCaller.auth.loginWithPhoneCode({ phone: '13800138000', code: '654321' }),
    ).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: '登录服务暂时不可用，请稍后重试',
      cause: issueFailure,
    });
    await expect(currentCaller.auth.currentSession()).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: '会话服务暂时不可用，请稍后重试',
      cause: currentFailure,
    });
    await expect(logoutCaller.auth.logout()).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: '退出登录暂时不可用，请稍后重试',
      cause: revokeFailure,
    });
  });
});
