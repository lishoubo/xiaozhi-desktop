import { initTRPC } from '@trpc/server';
import { z } from 'zod';

export type ApiContext = Record<string, never>;

const t = initTRPC.context<ApiContext>().create();

const healthResponseSchema = z.object({
  status: z.literal('ok'),
});

export const appRouter = t.router({
  system: t.router({
    health: t.procedure.output(healthResponseSchema).query(() => ({ status: 'ok' })),
  }),
});

export type AppRouter = typeof appRouter;
