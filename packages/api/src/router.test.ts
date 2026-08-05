import { describe, expect, it } from 'vitest';
import { appRouter } from './router';

describe('appRouter', () => {
  it('reports the server transport as healthy', async () => {
    const caller = appRouter.createCaller({});

    await expect(caller.system.health()).resolves.toEqual({ status: 'ok' });
  });
});
