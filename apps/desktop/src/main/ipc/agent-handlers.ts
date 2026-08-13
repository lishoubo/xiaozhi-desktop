import { z } from 'zod';
import type {
  AgentCapabilities,
  CancelAgentBusinessExecutionResult,
  CancelAgentRunResult,
  AgentConversation,
  AgentConversationDeletionResult,
  AgentConversationSummary,
  AgentQuickAction,
  StartAgentRunResponse,
  SubmitAgentClarificationResponse,
} from '@hotel-butler/api';
import {
  agentBusinessExecutionIdInputSchema,
  agentConversationIdInputSchema,
  startAgentRunInputSchema,
  submitAgentClarificationInputSchema,
} from '../../shared/agent';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { AppLogger } from '../../shared/logging';
import { createHandlerRegistry, type TrustedWindow } from './create-handler-registry';

export interface AgentOrchestrator {
  capabilities(): Promise<AgentCapabilities>;
  quickActions(): Promise<AgentQuickAction[]>;
  listConversations(): Promise<AgentConversationSummary[]>;
  createConversation(title?: string): Promise<AgentConversationSummary>;
  getConversation(conversationId: string): Promise<AgentConversation>;
  deleteConversation(conversationId: string): Promise<AgentConversationDeletionResult>;
  clearConversations(): Promise<AgentConversationDeletionResult>;
  startRun(input: z.infer<typeof startAgentRunInputSchema>): Promise<StartAgentRunResponse>;
  submitClarification(
    input: z.infer<typeof submitAgentClarificationInputSchema>,
  ): Promise<SubmitAgentClarificationResponse>;
  cancelBusinessExecution(
    businessExecutionId: string,
    expectedVersion: number,
  ): Promise<CancelAgentBusinessExecutionResult>;
  resumeRun(runId: string, conversationId: string, lastEventId: string | null): void;
  cancelRun(runId: string): Promise<CancelAgentRunResult>;
}

export function registerAgentHandlers({
  window,
  service,
  logger,
}: Readonly<{
  window: TrustedWindow;
  service: AgentOrchestrator;
  logger: AppLogger;
}>): () => void {
  const registry = createHandlerRegistry({ window, logger });
  registry.handle(IPC_CHANNELS.agent.capabilities, z.tuple([]), 'Agent 参数无效', () =>
    service.capabilities(),
  );
  registry.handle(IPC_CHANNELS.agent.quickActions, z.tuple([]), 'Agent 参数无效', () =>
    service.quickActions(),
  );
  registry.handle(IPC_CHANNELS.agent.listConversations, z.tuple([]), 'Agent 参数无效', () =>
    service.listConversations(),
  );
  registry.handle(
    IPC_CHANNELS.agent.createConversation,
    z.tuple([z.string().trim().min(1).max(120).nullable()]),
    'Agent 会话标题无效',
    (title) => service.createConversation(title ?? undefined),
  );
  registry.handle(
    IPC_CHANNELS.agent.getConversation,
    z.tuple([agentConversationIdInputSchema.shape.conversationId]),
    'Agent 会话标识无效',
    (conversationId) => service.getConversation(conversationId),
  );
  registry.handle(
    IPC_CHANNELS.agent.deleteConversation,
    z.tuple([agentConversationIdInputSchema.shape.conversationId]),
    'Agent 会话标识无效',
    (conversationId) => service.deleteConversation(conversationId),
  );
  registry.handle(IPC_CHANNELS.agent.clearConversations, z.tuple([]), 'Agent 参数无效', () =>
    service.clearConversations(),
  );
  registry.handle(
    IPC_CHANNELS.agent.startRun,
    z.tuple([startAgentRunInputSchema]),
    'Agent 请求参数无效',
    (input) => service.startRun(input),
  );
  registry.handle(
    IPC_CHANNELS.agent.submitClarification,
    z.tuple([submitAgentClarificationInputSchema]),
    'Agent 补充信息参数无效',
    (input) => service.submitClarification(input),
  );
  registry.handle(
    IPC_CHANNELS.agent.cancelBusinessExecution,
    z.tuple([
      agentBusinessExecutionIdInputSchema.shape.businessExecutionId,
      agentBusinessExecutionIdInputSchema.shape.expectedVersion,
    ]),
    'Agent 执行取消参数无效',
    (businessExecutionId, expectedVersion) =>
      service.cancelBusinessExecution(businessExecutionId, expectedVersion),
  );
  registry.handle(
    IPC_CHANNELS.agent.resumeRun,
    z.tuple([z.string().uuid(), z.string().uuid(), z.string().uuid().nullable()]),
    'Agent 恢复参数无效',
    (runId, conversationId, lastEventId) => service.resumeRun(runId, conversationId, lastEventId),
  );
  registry.handle(
    IPC_CHANNELS.agent.cancelRun,
    z.tuple([z.string().uuid()]),
    'Agent 运行标识无效',
    (runId) => service.cancelRun(runId),
  );
  return () => registry.dispose();
}
