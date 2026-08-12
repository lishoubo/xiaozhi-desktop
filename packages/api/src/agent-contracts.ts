import { z } from 'zod';

const idSchema = z.string().uuid();
const isoDateSchema = z.string().datetime({ offset: true });

export const agentConversationSummarySchema = z.strictObject({
  id: idSchema,
  title: z.string().min(1).max(120),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type AgentConversationSummary = Readonly<z.infer<typeof agentConversationSummarySchema>>;

export const generativeUiElementSchema = z.strictObject({
  type: z.string().min(1).max(64),
  props: z.record(z.string(), z.unknown()),
  children: z.array(z.string().min(1)).default([]),
  visible: z.boolean().default(true),
});
export const generativeUiSpecSchema = z.strictObject({
  root: z.string().min(1),
  state: z.record(z.string(), z.unknown()).default({}),
  elements: z.record(z.string().min(1), generativeUiElementSchema),
});
export type GenerativeUiSpec = Readonly<z.infer<typeof generativeUiSpecSchema>>;

const hotelChartTextSchema = z.string().trim().min(1).max(120);
export const hotelTrendChartPropsSchema = z.strictObject({
  title: hotelChartTextSchema,
  description: z.string().trim().max(200).optional(),
  data: z
    .array(
      z.strictObject({
        label: z.string().trim().min(1).max(30),
        value: z.number().finite(),
        comparison: z.number().finite().optional(),
      }),
    )
    .min(2)
    .max(31),
  valueLabel: z.string().trim().min(1).max(40),
  comparisonLabel: z.string().trim().min(1).max(40).optional(),
  unit: z.string().trim().max(20).optional(),
  source: z.string().trim().max(160).optional(),
});
export type HotelTrendChartProps = Readonly<z.infer<typeof hotelTrendChartPropsSchema>>;

export const hotelDistributionChartPropsSchema = z.strictObject({
  title: hotelChartTextSchema,
  description: z.string().trim().max(200).optional(),
  items: z
    .array(
      z.strictObject({
        label: z.string().trim().min(1).max(30),
        value: z.number().finite().nonnegative(),
      }),
    )
    .min(2)
    .max(5),
  unit: z.string().trim().max(20).optional(),
  centerLabel: z.string().trim().max(40).optional(),
  source: z.string().trim().max(160).optional(),
});
export type HotelDistributionChartProps = Readonly<
  z.infer<typeof hotelDistributionChartPropsSchema>
>;

export const hotelRadarChartPropsSchema = z.strictObject({
  title: hotelChartTextSchema,
  description: z.string().trim().max(200).optional(),
  items: z
    .array(
      z.strictObject({
        label: z.string().trim().min(1).max(20),
        value: z.number().finite().nonnegative(),
        benchmark: z.number().finite().nonnegative().optional(),
      }),
    )
    .min(3)
    .max(8),
  max: z.number().finite().positive(),
  valueLabel: z.string().trim().min(1).max(40),
  benchmarkLabel: z.string().trim().min(1).max(40).optional(),
  source: z.string().trim().max(160).optional(),
});
export type HotelRadarChartProps = Readonly<z.infer<typeof hotelRadarChartPropsSchema>>;

export const hotelRadialChartPropsSchema = z.strictObject({
  title: hotelChartTextSchema,
  description: z.string().trim().max(200).optional(),
  label: z.string().trim().min(1).max(40),
  value: z.number().finite().nonnegative(),
  max: z.number().finite().positive(),
  unit: z.string().trim().max(20).optional(),
  source: z.string().trim().max(160).optional(),
});
export type HotelRadialChartProps = Readonly<z.infer<typeof hotelRadialChartPropsSchema>>;

export const agentMessageSchema = z.strictObject({
  id: idSchema,
  conversationId: idSchema,
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  ui: generativeUiSpecSchema.nullable(),
  createdAt: isoDateSchema,
});
export type AgentMessage = Readonly<z.infer<typeof agentMessageSchema>>;

export const agentExecutionStepSchema = z.strictObject({
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  status: z.enum(['running', 'completed']),
  summary: z.string().max(500),
});
export type AgentExecutionStep = Readonly<z.infer<typeof agentExecutionStepSchema>>;

export const agentRunStatusSchema = z.enum(['running', 'completed', 'failed', 'cancelled']);
export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>;

export const agentExecutionTraceSchema = z.strictObject({
  runId: idSchema,
  userMessageId: idSchema,
  assistantMessageId: idSchema.nullable(),
  status: agentRunStatusSchema,
  steps: z.array(agentExecutionStepSchema),
  createdAt: isoDateSchema,
  completedAt: isoDateSchema.nullable(),
});
export type AgentExecutionTrace = Readonly<z.infer<typeof agentExecutionTraceSchema>>;

export const agentConversationSchema = z.strictObject({
  conversation: agentConversationSummarySchema,
  messages: z.array(agentMessageSchema),
  executions: z.array(agentExecutionTraceSchema),
});
export type AgentConversation = Readonly<z.infer<typeof agentConversationSchema>>;

export const agentCapabilitiesSchema = z.strictObject({
  model: z.string().min(1),
  mcpServerCount: z.number().int().nonnegative(),
  skillCount: z.number().int().nonnegative(),
  quickActionCount: z.number().int().nonnegative(),
  generativeUi: z.literal(true),
  longTermMemory: z.literal(true),
});
export type AgentCapabilities = Readonly<z.infer<typeof agentCapabilitiesSchema>>;

export const agentQuickActionIdSchema = z.enum([
  'today_weather',
  'public_hotel_rates',
  'hotel_operating_data',
]);
export type AgentQuickActionId = z.infer<typeof agentQuickActionIdSchema>;

export const agentQuickActionSchema = z.strictObject({
  id: agentQuickActionIdSchema,
  label: z.string().min(1).max(40),
  description: z.string().min(1).max(120),
  category: z.enum(['operations', 'orders', 'revenue', 'guest', 'finance']),
  requiresMcp: z.boolean(),
  available: z.boolean(),
});
export type AgentQuickAction = Readonly<z.infer<typeof agentQuickActionSchema>>;

const eventBase = {
  id: idSchema,
  runId: idSchema,
  conversationId: idSchema,
  createdAt: isoDateSchema,
} as const;

export const agentRunEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...eventBase, type: z.literal('run_started') }),
  z.strictObject({ ...eventBase, type: z.literal('text_delta'), delta: z.string().min(1) }),
  z.strictObject({
    ...eventBase,
    type: z.literal('tool_started'),
    toolCallId: z.string().min(1),
    toolName: z.string().min(1),
  }),
  z.strictObject({
    ...eventBase,
    type: z.literal('tool_completed'),
    toolCallId: z.string().min(1),
    toolName: z.string().min(1),
    summary: z.string().max(500),
  }),
  z.strictObject({ ...eventBase, type: z.literal('ui_spec'), spec: generativeUiSpecSchema }),
  z.strictObject({
    ...eventBase,
    type: z.literal('run_completed'),
    message: agentMessageSchema,
  }),
  z.strictObject({
    ...eventBase,
    type: z.literal('run_failed'),
    message: z.string().min(1).max(500),
    retryable: z.boolean(),
  }),
  z.strictObject({ ...eventBase, type: z.literal('run_cancelled') }),
]);
export type AgentRunEvent = Readonly<z.infer<typeof agentRunEventSchema>>;

export const createAgentConversationInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(120).optional(),
});
export const agentConversationIdInputSchema = z.strictObject({ conversationId: idSchema });
export const agentConversationDeletionResultSchema = z.strictObject({
  deletedCount: z.number().int().nonnegative(),
});
export type AgentConversationDeletionResult = Readonly<
  z.infer<typeof agentConversationDeletionResultSchema>
>;
const startAgentPromptRunInputSchema = z.strictObject({
  conversationId: idSchema,
  prompt: z.string().trim().min(1).max(20_000),
  clientRequestId: idSchema,
});
const startAgentQuickActionRunInputSchema = z.strictObject({
  conversationId: idSchema,
  quickActionId: agentQuickActionIdSchema,
  clientRequestId: idSchema,
});
export const startAgentRunInputSchema = z.union([
  startAgentPromptRunInputSchema,
  startAgentQuickActionRunInputSchema,
]);
export type StartAgentRunInput = Readonly<z.infer<typeof startAgentRunInputSchema>>;
export const startAgentRunResponseSchema = z.strictObject({
  runId: idSchema,
  userMessage: agentMessageSchema,
});
export type StartAgentRunResponse = Readonly<z.infer<typeof startAgentRunResponseSchema>>;
export const agentRunEventsInputSchema = z.strictObject({
  runId: idSchema,
  lastEventId: idSchema.nullish(),
});
export const agentRunIdInputSchema = z.strictObject({ runId: idSchema });
export const cancelAgentRunResultSchema = z.strictObject({
  runId: idSchema,
  status: z.enum(['completed', 'failed', 'cancelled']),
});
export type CancelAgentRunResult = Readonly<z.infer<typeof cancelAgentRunResultSchema>>;
