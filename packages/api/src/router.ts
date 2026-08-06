import { initTRPC } from '@trpc/server';
import { z } from 'zod';

type ApiLogFields = Record<string, string | number | boolean | null | undefined>;
// eslint-disable-next-line no-unused-vars -- parameter names document the structural logger contract.
type ApiLogMethod = (fields: ApiLogFields, message: string) => void;

export interface ApiLogger {
  debug: ApiLogMethod;
  info: ApiLogMethod;
  warn: ApiLogMethod;
  error: ApiLogMethod;
}

export const employeeIdentitySchema = z.strictObject({
  id: z.string().regex(/^\d+$/),
  orgId: z.string().regex(/^\d+$/),
  username: z.string().min(1),
  fullName: z.string().nullable(),
  phone: z.string().regex(/^1\d{10}$/),
  roleCode: z.string().min(1),
});

export type EmployeeIdentity = Readonly<z.infer<typeof employeeIdentitySchema>>;

export interface EmployeeIdentityDirectory {
  // eslint-disable-next-line no-unused-vars -- parameter name documents the directory contract.
  findActiveByPhone(phone: string): Promise<EmployeeIdentity | null>;
}

export interface ApiContext {
  employeeDirectory: EmployeeIdentityDirectory;
  logger: ApiLogger;
  requestId: string;
}

const t = initTRPC.context<ApiContext>().create();
const publicProcedure = t.procedure.use(async ({ ctx, next, path, type }) => {
  const startedAt = performance.now();
  const result = await next();

  if (result.ok) {
    const fields = {
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      event: 'trpc.procedure.completed',
      procedure: path,
      procedureType: type,
      requestId: ctx.requestId,
    };

    if (type === 'mutation') ctx.logger.info(fields, 'tRPC procedure completed');
    else ctx.logger.debug(fields, 'tRPC procedure completed');
  }

  return result;
});

const healthResponseSchema = z.object({
  status: z.literal('ok'),
});

export const appRouter = t.router({
  identity: t.router({
    employeeByPhone: publicProcedure
      .input(z.strictObject({ phone: z.string().regex(/^1\d{10}$/) }))
      .output(employeeIdentitySchema.nullable())
      .query(({ ctx, input }) => ctx.employeeDirectory.findActiveByPhone(input.phone)),
  }),
  system: t.router({
    health: publicProcedure.output(healthResponseSchema).query(() => ({ status: 'ok' })),
  }),
});

export type AppRouter = typeof appRouter;
