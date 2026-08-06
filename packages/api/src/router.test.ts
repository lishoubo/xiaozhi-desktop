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

  function createCaller(findActiveByPhone = vi.fn().mockResolvedValue(null)) {
    return appRouter.createCaller({
      employeeDirectory: { findActiveByPhone },
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      requestId: 'request-123',
    });
  }

  it('reports the server transport as healthy', async () => {
    const debug = vi.fn();
    const caller = appRouter.createCaller({
      employeeDirectory: { findActiveByPhone: vi.fn().mockResolvedValue(null) },
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

  it('resolves a safe active RMS employee identity by phone', async () => {
    const findActiveByPhone = vi.fn().mockResolvedValue(activeEmployee);
    const caller = createCaller(findActiveByPhone);

    await expect(caller.identity.employeeByPhone({ phone: '13800138000' })).resolves.toEqual(
      activeEmployee,
    );
    expect(findActiveByPhone).toHaveBeenCalledWith('13800138000');
    expect(JSON.stringify(activeEmployee)).not.toContain('password');
  });

  it('returns no identity for an unavailable employee and rejects malformed phones', async () => {
    const caller = createCaller();

    await expect(caller.identity.employeeByPhone({ phone: '13900139000' })).resolves.toBeNull();
    await expect(caller.identity.employeeByPhone({ phone: 'employee-1' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });
});
