import { z } from 'zod';
import {
  agentCapabilitiesSchema,
  agentConversationSchema,
  agentConversationSummarySchema,
  agentQuickActionSchema,
  agentStreamEnvelopeSchema,
  startAgentRunResponseSchema,
  type AgentStreamEnvelope,
} from '../../shared/agent';
import type { StartAgentRunInput } from '@hotel-butler/api/contracts';
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
    startRun: (input: StartAgentRunInput) =>
      invoke(startAgentRunResponseSchema, IPC_CHANNELS.agent.startRun, input),
    cancelRun: (runId: string) => invoke(z.undefined(), IPC_CHANNELS.agent.cancelRun, runId),
    onStreamEvent: (listener: (event: AgentStreamEnvelope) => void) =>
      subscribe(agentStreamEnvelopeSchema, IPC_CHANNELS.agent.streamEvent, listener),
  });
}
