import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { appRouter } from './router';

describe('appRouter', () => {
  it('reports the server transport as healthy', async () => {
    const debug = vi.fn();
    const caller = appRouter.createCaller({
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
});
