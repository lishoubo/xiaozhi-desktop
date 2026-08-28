import type {
  AgentCapabilities,
  AgentConversation,
  AgentConversationDeletionResult,
  AgentConversationSummary,
  AgentQuickAction,
  AgentRunEvent,
  CancelAgentRunResult,
  CancelAgentBusinessExecutionResult,
  StartAgentRunInput,
  StartAgentRunResponse,
  RetryAgentRunInput,
  RetryAgentRunResponse,
  SubmitAgentClarificationInput,
  SubmitAgentClarificationResponse,
} from '@hotel-butler/api';
import { safeLogErrorDetails, type AppLogger } from '../../shared/logging';

export type AgentStreamEnvelope =
  | Readonly<{ kind: 'event'; event: AgentRunEvent }>
  | Readonly<{ kind: 'transport_error'; runId: string; message: string }>;

export interface AgentClient {
  agent: {
    capabilities: { query(): Promise<AgentCapabilities> };
    quickActions: { query(): Promise<AgentQuickAction[]> };
    listConversations: { query(): Promise<AgentConversationSummary[]> };
    createConversation: {
      mutate(input: { title?: string }): Promise<AgentConversationSummary>;
    };
    getConversation: {
      query(input: { conversationId: string }): Promise<AgentConversation>;
    };
    deleteConversation: {
      mutate(input: { conversationId: string }): Promise<AgentConversationDeletionResult>;
    };
    clearConversations: { mutate(): Promise<AgentConversationDeletionResult> };
    startRun: {
      mutate(input: StartAgentRunInput): Promise<StartAgentRunResponse>;
    };
    retryRun: { mutate(input: RetryAgentRunInput): Promise<RetryAgentRunResponse> };
    submitClarification: {
      mutate(input: SubmitAgentClarificationInput): Promise<SubmitAgentClarificationResponse>;
    };
    cancelBusinessExecution: {
      mutate(input: {
        businessExecutionId: string;
        expectedVersion: number;
      }): Promise<CancelAgentBusinessExecutionResult>;
    };
    cancelRun: { mutate(input: { runId: string }): Promise<CancelAgentRunResult> };
    events: {
      subscribe(
        input: { runId: string; lastEventId: string | null },
        handlers: {
          onData(event: { id: string; data: AgentRunEvent }): void;
          onError(error: Error): void;
          onComplete(): void;
        },
      ): Readonly<{ unsubscribe(): void }>;
    };
  };
}

export class AgentService {
  private readonly subscriptions = new Map<string, Readonly<{ unsubscribe(): void }>>();

  constructor(
    private readonly client: AgentClient,
    private readonly notify: (envelope: AgentStreamEnvelope) => void,
    private readonly logger: AppLogger,
  ) {}

  capabilities(): Promise<AgentCapabilities> {
    return this.client.agent.capabilities.query();
  }

  quickActions(): Promise<AgentQuickAction[]> {
    return this.client.agent.quickActions.query();
  }

  async listConversations(): Promise<AgentConversationSummary[]> {
    const startedAt = performance.now();
    const conversations = await this.client.agent.listConversations.query();
    this.logger.info('Agent conversations loaded', {
      event: 'agent.client.conversations.loaded',
      conversationCount: conversations.length,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    });
    return conversations;
  }

  async createConversation(title?: string): Promise<AgentConversationSummary> {
    const conversation = await this.client.agent.createConversation.mutate({ title });
    this.logger.info('Agent conversation created', {
      event: 'agent.client.conversation.created',
      conversationId: conversation.id,
    });
    return conversation;
  }

  async getConversation(conversationId: string): Promise<AgentConversation> {
    const startedAt = performance.now();
    const conversation = await this.client.agent.getConversation.query({ conversationId });
    this.logger.info('Agent conversation opened', {
      event: 'agent.client.conversation.opened',
      conversationId,
      activeRunId: conversation.activeRun?.runId ?? null,
      messageCount: conversation.messages.length,
      executionCount: conversation.executions.length,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    });
    return conversation;
  }

  async deleteConversation(conversationId: string): Promise<AgentConversationDeletionResult> {
    const startedAt = performance.now();
    const result = await this.client.agent.deleteConversation.mutate({ conversationId });
    this.logger.info('Agent conversation deleted', {
      event: 'agent.client.conversation.deleted',
      conversationId,
      deletedCount: result.deletedCount,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    });
    return result;
  }

  async clearConversations(): Promise<AgentConversationDeletionResult> {
    const startedAt = performance.now();
    const result = await this.client.agent.clearConversations.mutate();
    this.logger.info('Agent conversations cleared', {
      event: 'agent.client.conversations.cleared',
      deletedCount: result.deletedCount,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    });
    return result;
  }

  async startRun(input: StartAgentRunInput): Promise<StartAgentRunResponse> {
    const startedAt = performance.now();
    let started: StartAgentRunResponse;
    try {
      started = await this.client.agent.startRun.mutate(input);
    } catch (error) {
      this.logger.error('Agent run could not be started', {
        event: 'agent.client.run.start_failed',
        conversationId: input.conversationId,
        requestKind: 'prompt' in input ? 'prompt' : 'quick_action',
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        error: safeLogErrorDetails(error),
      });
      throw error;
    }
    this.logger.info('Agent run started', {
      event: 'agent.client.run.started',
      runId: started.runId,
      conversationId: input.conversationId,
      requestKind: 'prompt' in input ? 'prompt' : 'quick_action',
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    });
    this.subscribeToRun(started.runId, input.conversationId, null, startedAt);
    return started;
  }

  async submitClarification(
    input: SubmitAgentClarificationInput,
  ): Promise<SubmitAgentClarificationResponse> {
    const started = await this.client.agent.submitClarification.mutate(input);
    this.subscribeToRun(started.runId, started.userMessage.conversationId, null, performance.now());
    return started;
  }

  async retryRun(input: RetryAgentRunInput): Promise<RetryAgentRunResponse> {
    const startedAt = performance.now();
    const started = await this.client.agent.retryRun.mutate(input);
    this.logger.info('Agent run retry started', {
      event: 'agent.client.run.retry_started',
      runId: started.runId,
      failedRunId: input.failedRunId,
      conversationId: started.userMessage.conversationId,
    });
    this.subscribeToRun(started.runId, started.userMessage.conversationId, null, startedAt);
    return started;
  }

  cancelBusinessExecution(
    businessExecutionId: string,
    expectedVersion: number,
  ): Promise<CancelAgentBusinessExecutionResult> {
    return this.client.agent.cancelBusinessExecution.mutate({
      businessExecutionId,
      expectedVersion,
    });
  }

  resumeRun(runId: string, conversationId: string, lastEventId: string | null): void {
    this.logger.info('Agent event subscription recovery requested', {
      event: 'agent.client.events.recovery_requested',
      runId,
      conversationId,
      hasCursor: lastEventId !== null,
    });
    this.subscribeToRun(runId, conversationId, lastEventId, performance.now());
  }

  private subscribeToRun(
    runId: string,
    conversationId: string,
    lastEventId: string | null,
    startedAt: number,
  ): void {
    this.subscriptions.get(runId)?.unsubscribe();
    const subscription = this.client.agent.events.subscribe(
      { runId, lastEventId },
      {
        onData: (trackedEvent) => {
          const event = trackedEvent.data;
          if (
            event.type === 'tool_started' ||
            event.type === 'tool_completed' ||
            event.type === 'tool_failed'
          ) {
            const fields = {
              event: `agent.client.${event.type}`,
              runId: event.runId,
              conversationId: event.conversationId,
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              ...(event.type === 'tool_failed' ? { failureCode: event.code } : {}),
            };
            if (event.type === 'tool_failed') {
              this.logger.warn('Agent client tool state changed', fields);
            } else {
              this.logger.info('Agent client tool state changed', fields);
            }
          } else if (
            event.type === 'run_completed' ||
            event.type === 'run_failed' ||
            event.type === 'run_cancelled'
          ) {
            this.logger.info('Agent client run reached terminal state', {
              event: `agent.client.${event.type}`,
              runId: event.runId,
              conversationId: event.conversationId,
              durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
            });
          }
          this.notify({ kind: 'event', event });
        },
        onError: (error) => {
          this.logger.warn('Agent event subscription failed', {
            event: 'agent.client.events.failed',
            runId,
            conversationId,
            durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
            error: safeLogErrorDetails(error),
          });
          this.notify({
            kind: 'transport_error',
            runId,
            message: '与小智的流式连接已中断，请重新打开会话。',
          });
          if (this.subscriptions.get(runId) === subscription) this.subscriptions.delete(runId);
        },
        onComplete: () => {
          if (this.subscriptions.get(runId) === subscription) this.subscriptions.delete(runId);
        },
      },
    );
    this.subscriptions.set(runId, subscription);
    this.logger.info('Agent event subscription connected', {
      event: 'agent.client.events.connected',
      runId,
      conversationId,
      hasCursor: lastEventId !== null,
    });
  }

  async cancelRun(runId: string): Promise<CancelAgentRunResult> {
    const startedAt = performance.now();
    try {
      const result = await this.client.agent.cancelRun.mutate({ runId });
      this.subscriptions.get(runId)?.unsubscribe();
      this.subscriptions.delete(runId);
      this.logger.info('Agent run cancellation acknowledged', {
        event: 'agent.client.run.cancelled',
        runId,
        status: result.status,
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      });
      return result;
    } catch (error) {
      this.logger.error('Agent run cancellation failed', {
        event: 'agent.client.run.cancel_failed',
        runId,
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        error: safeLogErrorDetails(error),
      });
      throw error;
    }
  }

  dispose(): void {
    for (const subscription of this.subscriptions.values()) subscription.unsubscribe();
    this.subscriptions.clear();
  }
}
