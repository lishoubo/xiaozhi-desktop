import type {
  AgentCapabilities,
  AgentConversation,
  AgentConversationSummary,
  AgentQuickAction,
  AgentRunEvent,
  StartAgentRunInput,
  StartAgentRunResponse,
} from '@hotel-butler/api';
import type { AppLogger } from '../../shared/logging';

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
    startRun: {
      mutate(input: StartAgentRunInput): Promise<StartAgentRunResponse>;
    };
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

  listConversations(): Promise<AgentConversationSummary[]> {
    return this.client.agent.listConversations.query();
  }

  createConversation(title?: string): Promise<AgentConversationSummary> {
    return this.client.agent.createConversation.mutate({ title });
  }

  getConversation(conversationId: string): Promise<AgentConversation> {
    return this.client.agent.getConversation.query({ conversationId });
  }

  async startRun(input: StartAgentRunInput): Promise<StartAgentRunResponse> {
    const started = await this.client.agent.startRun.mutate(input);
    this.subscriptions.get(started.runId)?.unsubscribe();
    const subscription = this.client.agent.events.subscribe(
      { runId: started.runId, lastEventId: null },
      {
        onData: (trackedEvent) => this.notify({ kind: 'event', event: trackedEvent.data }),
        onError: (error) => {
          this.logger.warn('Agent event subscription failed', {
            runId: started.runId,
            errorName: error.name,
          });
          this.notify({
            kind: 'transport_error',
            runId: started.runId,
            message: '与小智的流式连接已中断，请重新打开会话。',
          });
          this.subscriptions.delete(started.runId);
        },
        onComplete: () => this.subscriptions.delete(started.runId),
      },
    );
    this.subscriptions.set(started.runId, subscription);
    return started;
  }

  cancelRun(runId: string): void {
    this.subscriptions.get(runId)?.unsubscribe();
    this.subscriptions.delete(runId);
  }

  dispose(): void {
    for (const subscription of this.subscriptions.values()) subscription.unsubscribe();
    this.subscriptions.clear();
  }
}
