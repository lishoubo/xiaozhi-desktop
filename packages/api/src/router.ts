import { initTRPC, TRPCError } from '@trpc/server';
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

export interface PhoneOtpGateway {
  // eslint-disable-next-line no-unused-vars -- parameter name documents the gateway contract.
  requestCode(phone: string): Promise<Readonly<{ expiresInSeconds: number }>>;
  // eslint-disable-next-line no-unused-vars -- parameter names document the gateway contract.
  verifyCode(phone: string, code: string): Promise<boolean>;
}

export interface ApiContext {
  employeeDirectory: EmployeeIdentityDirectory;
  phoneOtp: PhoneOtpGateway;
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

export const phoneNumberSchema = z.string().regex(/^1\d{10}$/);
export const phoneCodeSchema = z.string().regex(/^\d{6}$/);

const phoneCodeRequestResponseSchema = z.strictObject({
  accepted: z.literal(true),
  expiresInSeconds: z.number().int().positive(),
});

const invalidPhoneCodeError = (): TRPCError =>
  new TRPCError({
    code: 'UNAUTHORIZED',
    message: '手机号或验证码不正确',
  });

const serviceUnavailableError = (message: string, cause: unknown): TRPCError =>
  new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message,
    cause,
  });

export const appRouter = t.router({
  auth: t.router({
    requestPhoneCode: publicProcedure
      .input(z.strictObject({ phone: phoneNumberSchema }))
      .output(phoneCodeRequestResponseSchema)
      .mutation(async ({ ctx, input }) => {
        try {
          const result = await ctx.phoneOtp.requestCode(input.phone);
          return { accepted: true, expiresInSeconds: result.expiresInSeconds };
        } catch (cause) {
          throw serviceUnavailableError('验证码服务暂时不可用，请稍后重试', cause);
        }
      }),
    loginWithPhoneCode: publicProcedure
      .input(z.strictObject({ phone: phoneNumberSchema, code: phoneCodeSchema }))
      .output(employeeIdentitySchema)
      .mutation(async ({ ctx, input }) => {
        let verified: boolean;
        try {
          verified = await ctx.phoneOtp.verifyCode(input.phone, input.code);
        } catch (cause) {
          throw serviceUnavailableError('验证码服务暂时不可用，请稍后重试', cause);
        }
        if (!verified) throw invalidPhoneCodeError();

        let employee: EmployeeIdentity | null;
        try {
          employee = await ctx.employeeDirectory.findActiveByPhone(input.phone);
        } catch (cause) {
          throw serviceUnavailableError('登录服务暂时不可用，请稍后重试', cause);
        }
        if (!employee) throw invalidPhoneCodeError();
        return employee;
      }),
  }),
  system: t.router({
    health: publicProcedure.output(healthResponseSchema).query(() => ({ status: 'ok' })),
  }),
});

export type AppRouter = typeof appRouter;
