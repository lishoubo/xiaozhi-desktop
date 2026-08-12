import { initTRPC, tracked, TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  agentCapabilitiesSchema,
  agentRunIdInputSchema,
  cancelAgentRunResultSchema,
  agentConversationDeletionResultSchema,
  agentConversationIdInputSchema,
  agentConversationSchema,
  agentConversationSummarySchema,
  agentQuickActionSchema,
  agentRunEventsInputSchema,
  createAgentConversationInputSchema,
  employeeIdentitySchema,
  logoutResponseSchema,
  phoneCodeRequestResponseSchema,
  phoneCodeSchema,
  phoneNumberSchema,
  startAgentRunInputSchema,
  startAgentRunResponseSchema,
  type AgentCapabilities,
  type CancelAgentRunResult,
  type AgentConversation,
  type AgentConversationDeletionResult,
  type AgentConversationSummary,
  type AgentQuickAction,
  type AgentRunEvent,
  type EmployeeIdentity,
  type StartAgentRunResponse,
  type StartAgentRunInput,
} from './contracts';

export {
  agentCapabilitiesSchema,
  agentRunIdInputSchema,
  cancelAgentRunResultSchema,
  agentConversationDeletionResultSchema,
  agentConversationIdInputSchema,
  agentConversationSchema,
  agentConversationSummarySchema,
  agentExecutionStepSchema,
  agentExecutionTraceSchema,
  agentMessageSchema,
  agentQuickActionIdSchema,
  agentQuickActionSchema,
  agentRunEventSchema,
  agentRunEventsInputSchema,
  createAgentConversationInputSchema,
  employeeIdentitySchema,
  logoutResponseSchema,
  phoneCodeRequestResponseSchema,
  phoneCodeSchema,
  phoneNumberSchema,
  generativeUiElementSchema,
  generativeUiSpecSchema,
  hotelDistributionChartPropsSchema,
  hotelRadarChartPropsSchema,
  hotelRadialChartPropsSchema,
  hotelTrendChartPropsSchema,
  staffIdentitySchema,
  staffLogoutResponseSchema,
  staffPasswordSchema,
  staffUsernameSchema,
  startAgentRunInputSchema,
  startAgentRunResponseSchema,
  type AgentCapabilities,
  type CancelAgentRunResult,
  type AgentConversation,
  type AgentConversationDeletionResult,
  type AgentConversationSummary,
  type AgentExecutionStep,
  type AgentExecutionTrace,
  type AgentMessage,
  type AgentQuickAction,
  type AgentQuickActionId,
  type AgentRunEvent,
  type EmployeeIdentity,
  type GenerativeUiSpec,
  type HotelDistributionChartProps,
  type HotelRadarChartProps,
  type HotelRadialChartProps,
  type HotelTrendChartProps,
  type StaffIdentity,
  type StartAgentRunResponse,
  type StartAgentRunInput,
} from './contracts';

export { agentRunStatusSchema, type AgentRunStatus } from './contracts';

type ApiLogFields = Record<string, unknown>;
// eslint-disable-next-line no-unused-vars -- parameter names document the structural logger contract.
type ApiLogMethod = (fields: ApiLogFields, message: string) => void;

export interface ApiLogger {
  debug: ApiLogMethod;
  info: ApiLogMethod;
  warn: ApiLogMethod;
  error: ApiLogMethod;
}

export interface EmployeeIdentityDirectory {
  // eslint-disable-next-line no-unused-vars -- parameter name documents the directory contract.
  findActiveById(id: string): Promise<EmployeeIdentity | null>;
  // eslint-disable-next-line no-unused-vars -- parameter name documents the directory contract.
  findActiveByPhone(phone: string): Promise<EmployeeIdentity | null>;
}

export interface PhoneOtpGateway {
  // eslint-disable-next-line no-unused-vars -- parameter name documents the gateway contract.
  requestCode(phone: string): Promise<Readonly<{ expiresInSeconds: number }>>;
  // eslint-disable-next-line no-unused-vars -- parameter names document the gateway contract.
  verifyCode(phone: string, code: string): Promise<boolean>;
}

export interface DesktopSessionGateway {
  currentEmployee(): Promise<EmployeeIdentity | null>;
  // eslint-disable-next-line no-unused-vars -- parameter name documents the session contract.
  issue(employee: EmployeeIdentity): Promise<void>;
  revoke(): Promise<void>;
}

export type AgentPrincipal = Readonly<{ employeeId: string; orgId: string }>;

/* eslint-disable no-unused-vars -- parameter names document the server-owned gateway contract. */
export interface AgentGateway {
  capabilities(): Promise<AgentCapabilities>;
  quickActions(): Promise<readonly AgentQuickAction[]>;
  listConversations(principal: AgentPrincipal): Promise<AgentConversationSummary[]>;
  createConversation(principal: AgentPrincipal, title?: string): Promise<AgentConversationSummary>;
  getConversation(principal: AgentPrincipal, conversationId: string): Promise<AgentConversation>;
  deleteConversation(
    principal: AgentPrincipal,
    conversationId: string,
  ): Promise<AgentConversationDeletionResult>;
  clearConversations(principal: AgentPrincipal): Promise<AgentConversationDeletionResult>;
  startRun(principal: AgentPrincipal, input: StartAgentRunInput): Promise<StartAgentRunResponse>;
  cancelRun(principal: AgentPrincipal, runId: string): Promise<CancelAgentRunResult>;
  events(
    principal: AgentPrincipal,
    input: Readonly<{ runId: string; lastEventId?: string | null }>,
    signal?: AbortSignal,
  ): AsyncIterable<AgentRunEvent>;
}
/* eslint-enable no-unused-vars */

export interface ApiContext {
  agent: AgentGateway;
  agentPrincipal(): Promise<AgentPrincipal | null>;
  desktopSession: DesktopSessionGateway;
  employeeDirectory: EmployeeIdentityDirectory;
  phoneOtp: PhoneOtpGateway;
  logger: ApiLogger;
  requestId: string;
}

const t = initTRPC.context<ApiContext>().create({
  sse: {
    ping: { enabled: true, intervalMs: 2_000 },
    client: { reconnectAfterInactivityMs: 5_000 },
  },
});

const serviceUnavailableError = (message: string, cause: unknown): TRPCError =>
  new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message,
    cause,
  });

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

const protectedProcedure = publicProcedure.use(async ({ ctx, next }) => {
  let employee: EmployeeIdentity | null;
  try {
    employee = await ctx.desktopSession.currentEmployee();
  } catch (cause) {
    throw serviceUnavailableError('会话服务暂时不可用，请稍后重试', cause);
  }

  if (!employee) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: '请先登录' });
  }

  return next({ ctx: { ...ctx, employee } });
});

const agentProcedure = publicProcedure.use(async ({ ctx, next }) => {
  let principal: AgentPrincipal | null;
  try {
    principal = await ctx.agentPrincipal();
  } catch (cause) {
    throw serviceUnavailableError('Agent 身份验证服务暂时不可用，请稍后重试', cause);
  }
  if (!principal) throw new TRPCError({ code: 'UNAUTHORIZED', message: '请先登录' });
  return next({ ctx: { ...ctx, agentPrincipal: principal } });
});

const healthResponseSchema = z.object({
  status: z.literal('ok'),
});

const invalidPhoneCodeError = (): TRPCError =>
  new TRPCError({
    code: 'UNAUTHORIZED',
    message: '手机号或验证码不正确',
  });

export const appRouter = t.router({
  agent: t.router({
    capabilities: agentProcedure
      .output(agentCapabilitiesSchema)
      .query(({ ctx }) => ctx.agent.capabilities()),
    quickActions: agentProcedure
      .output(z.array(agentQuickActionSchema))
      .query(async ({ ctx }) => [...(await ctx.agent.quickActions())]),
    listConversations: agentProcedure
      .output(z.array(agentConversationSummarySchema))
      .query(async ({ ctx }) => [...(await ctx.agent.listConversations(ctx.agentPrincipal))]),
    createConversation: agentProcedure
      .input(createAgentConversationInputSchema)
      .output(agentConversationSummarySchema)
      .mutation(({ ctx, input }) => ctx.agent.createConversation(ctx.agentPrincipal, input.title)),
    getConversation: agentProcedure
      .input(agentConversationIdInputSchema)
      .output(agentConversationSchema)
      .query(({ ctx, input }) =>
        ctx.agent.getConversation(ctx.agentPrincipal, input.conversationId),
      ),
    deleteConversation: agentProcedure
      .input(agentConversationIdInputSchema)
      .output(agentConversationDeletionResultSchema)
      .mutation(({ ctx, input }) =>
        ctx.agent.deleteConversation(ctx.agentPrincipal, input.conversationId),
      ),
    clearConversations: agentProcedure
      .output(agentConversationDeletionResultSchema)
      .mutation(({ ctx }) => ctx.agent.clearConversations(ctx.agentPrincipal)),
    startRun: agentProcedure
      .input(startAgentRunInputSchema)
      .output(startAgentRunResponseSchema)
      .mutation(({ ctx, input }) => ctx.agent.startRun(ctx.agentPrincipal, input)),
    cancelRun: agentProcedure
      .input(agentRunIdInputSchema)
      .output(cancelAgentRunResultSchema)
      .mutation(({ ctx, input }) => ctx.agent.cancelRun(ctx.agentPrincipal, input.runId)),
    events: agentProcedure.input(agentRunEventsInputSchema).subscription(async function* ({
      ctx,
      input,
      signal,
    }) {
      for await (const event of ctx.agent.events(ctx.agentPrincipal, input, signal)) {
        yield tracked(event.id, event);
      }
    }),
  }),
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
        try {
          await ctx.desktopSession.issue(employee);
        } catch (cause) {
          throw serviceUnavailableError('登录服务暂时不可用，请稍后重试', cause);
        }
        return employee;
      }),
    currentSession: publicProcedure
      .output(employeeIdentitySchema.nullable())
      .query(async ({ ctx }) => {
        try {
          return await ctx.desktopSession.currentEmployee();
        } catch (cause) {
          throw serviceUnavailableError('会话服务暂时不可用，请稍后重试', cause);
        }
      }),
    logout: protectedProcedure.output(logoutResponseSchema).mutation(async ({ ctx }) => {
      try {
        await ctx.desktopSession.revoke();
      } catch (cause) {
        throw serviceUnavailableError('退出登录暂时不可用，请稍后重试', cause);
      }
      return { success: true };
    }),
  }),
  system: t.router({
    health: publicProcedure.output(healthResponseSchema).query(() => ({ status: 'ok' })),
  }),
});

export type AppRouter = typeof appRouter;
