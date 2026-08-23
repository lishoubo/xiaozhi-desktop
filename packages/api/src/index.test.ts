import { describe, expect, it } from 'vitest';
import * as contracts from './index';
import { appRouter, type AppRouter as ServerAppRouter } from './router';
import type { AppRouter } from './index';

describe('@hotel-butler/api exports', () => {
  it('keeps the default entry serializable while preserving the type-only router projection', () => {
    const projected: AppRouter = appRouter;
    const serverProjected: ServerAppRouter = projected;

    expect(serverProjected).toBe(appRouter);
    expect(contracts).toHaveProperty('employeeIdentitySchema');
    expect(contracts).not.toHaveProperty('appRouter');
  });
});
