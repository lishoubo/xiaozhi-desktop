/* eslint-disable import/no-unresolved -- ESLint's legacy resolver does not read this workspace package export. */
import {
  agentCapabilitiesSchema,
  agentConversationDeletionResultSchema,
  agentConversationIdInputSchema,
  agentConversationSchema,
  agentConversationSummarySchema,
  agentQuickActionSchema,
  agentRunEventSchema,
  cancelAgentRunResultSchema,
  startAgentRunInputSchema,
  startAgentRunResponseSchema,
} from '@hotel-butler/api/contracts';
/* eslint-enable import/no-unresolved */
import { z } from 'zod';

export {
  agentCapabilitiesSchema,
  agentConversationDeletionResultSchema,
  agentConversationIdInputSchema,
  agentConversationSchema,
  agentConversationSummarySchema,
  agentQuickActionSchema,
  cancelAgentRunResultSchema,
  startAgentRunInputSchema,
  startAgentRunResponseSchema,
};

export const agentStreamEnvelopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('event'), event: agentRunEventSchema }),
  z.strictObject({
    kind: z.literal('transport_error'),
    runId: z.string().uuid(),
    message: z.string().min(1).max(500),
  }),
]);

export type AgentStreamEnvelope = z.infer<typeof agentStreamEnvelopeSchema>;
