import { z } from 'zod';
import {
  agentCapabilitiesSchema,
  agentConversationDeletionResultSchema,
  agentConversationSchema,
  agentConversationSummarySchema,
  agentQuickActionSchema,
  agentStreamEnvelopeSchema,
  cancelAgentRunResultSchema,
  cancelAgentBusinessExecutionResultSchema,
  startAgentRunResponseSchema,
  submitAgentClarificationResponseSchema,
  type AgentStreamEnvelope,
} from '../../shared/agent';
import type {
  StartAgentRunInput,
  SubmitAgentClarificationInput,
} from '@hotel-butler/api/contracts';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { ValidatedInvoke, ValidatedSubscribe } from '../invoke';

export function createAgentApi(invoke: ValidatedInvoke, subscribe: ValidatedSubscribe) {
  return Object.freeze({
    capabilities: () => invoke(agentCapabilitiesSchema, IPC_CHANNELS.agent.capabilities),
    quickActions: () => invoke(z.array(agentQuickActionSchema), IPC_CHANNELS.agent.quickActions),
    listConversations: () =>
      invoke(z.array(agentConversationSummarySchema), IPC_CHANNELS.agent.listConversations),
    createConversation: (title?: string) =>
      invoke(agentConversationSummarySchema, IPC_CHANNELS.agent.createConversation, title ?? null),
    getConversation: (conversationId: string) =>
      invoke(agentConversationSchema, IPC_CHANNELS.agent.getConversation, conversationId),
    deleteConversation: (conversationId: string) =>
      invoke(
        agentConversationDeletionResultSchema,
        IPC_CHANNELS.agent.deleteConversation,
        conversationId,
      ),
    clearConversations: () =>
      invoke(agentConversationDeletionResultSchema, IPC_CHANNELS.agent.clearConversations),
    startRun: (input: StartAgentRunInput) =>
      invoke(startAgentRunResponseSchema, IPC_CHANNELS.agent.startRun, input),
    submitClarification: (input: SubmitAgentClarificationInput) =>
      invoke(submitAgentClarificationResponseSchema, IPC_CHANNELS.agent.submitClarification, input),
    cancelBusinessExecution: (businessExecutionId: string, expectedVersion: number) =>
      invoke(
        cancelAgentBusinessExecutionResultSchema,
        IPC_CHANNELS.agent.cancelBusinessExecution,
        businessExecutionId,
        expectedVersion,
      ),
    resumeRun: (runId: string, conversationId: string, lastEventId: string | null) =>
      invoke(z.undefined(), IPC_CHANNELS.agent.resumeRun, runId, conversationId, lastEventId),
    cancelRun: (runId: string) =>
      invoke(cancelAgentRunResultSchema, IPC_CHANNELS.agent.cancelRun, runId),
    onStreamEvent: (listener: (event: AgentStreamEnvelope) => void) =>
      subscribe(agentStreamEnvelopeSchema, IPC_CHANNELS.agent.streamEvent, listener),
  });
}
