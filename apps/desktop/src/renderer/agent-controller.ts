import type {
  AgentConversation,
  AgentConversationDeletionResult,
  AgentConversationSummary,
  AgentQuickAction,
  AgentQuickActionId,
  AgentRunEvent,
  CancelAgentBusinessExecutionResult,
  CancelAgentRunResult,
  RetryAgentRunInput,
  RetryAgentRunResponse,
  StartAgentRunInput,
  StartAgentRunResponse,
  SubmitAgentClarificationInput,
  SubmitAgentClarificationResponse,
} from '@hotel-butler/api';
import type { AgentStreamEnvelope } from '../shared/agent';
import {
  addStartedRun,
  applyRunEvent,
  createEmptyConversationView,
  hydrateConversationView,
  withConversationError,
  type AgentConversationViewState,
} from './agent-conversation-state';
import { isPendingBusinessExecutionConflict } from './agent-presentation';

export type AgentDesktopAdapter = Readonly<{
  quickActions(): Promise<AgentQuickAction[]>;
  listConversations(): Promise<AgentConversationSummary[]>;
  createConversation(title?: string): Promise<AgentConversationSummary>;
  getConversation(conversationId: string): Promise<AgentConversation>;
  deleteConversation(conversationId: string): Promise<AgentConversationDeletionResult>;
  clearConversations(): Promise<AgentConversationDeletionResult>;
  startRun(input: StartAgentRunInput): Promise<StartAgentRunResponse>;
  retryRun(input: RetryAgentRunInput): Promise<RetryAgentRunResponse>;
  submitClarification(input: SubmitAgentClarificationInput): Promise<SubmitAgentClarificationResponse>;
  cancelBusinessExecution(
    businessExecutionId: string,
    expectedVersion: number,
  ): Promise<CancelAgentBusinessExecutionResult>;
  resumeRun(runId: string, conversationId: string, lastEventId: string | null): Promise<void>;
  cancelRun(runId: string): Promise<CancelAgentRunResult>;
  onStreamEvent(listener: (event: AgentStreamEnvelope) => void): () => void;
}>;

export type AgentControllerState = Readonly<{
  conversations: readonly AgentConversationSummary[];
  quickActions: readonly AgentQuickAction[];
  activeConversationId: string | null;
  pendingConversationId: string | null;
  conversationViews: ReadonlyMap<string, AgentConversationViewState>;
  loading: boolean;
  starting: boolean;
  stoppingRunId: string | null;
  retryingRunId: string | null;
  clarificationSubmitting: boolean;
  deleting: boolean;
  pageErrorMessage: string;
}>;

type ControllerOptions = Readonly<{
  randomId?: () => string;
  now?: () => string;
  schedule?: (callback: () => void, delayMs: number) => void;
}>;

type StartRequest = { prompt: string } | { quickActionId: AgentQuickActionId };
type ClarificationResponse =
  | { responseText: string }
  | { answers: Readonly<Record<string, string | number | { start: string; end: string }>> };

export type AgentController = Readonly<{
  state: AgentControllerState;
  subscribe(listener: (state: AgentControllerState) => void): () => void;
  initialize(): Promise<void>;
  startNewConversation(): void;
  openConversation(conversationId: string): Promise<void>;
  loadConversation(conversationId: string): Promise<void>;
  startRun(request: StartRequest): Promise<boolean>;
  executeQuickAction(action: AgentQuickAction): Promise<void>;
  retryFailedRun(): Promise<void>;
  cancelActiveRun(): Promise<void>;
  submitClarification(response: ClarificationResponse): Promise<boolean>;
  cancelPendingBusinessExecution(): Promise<void>;
  deleteConversation(conversationId: string): Promise<void>;
  clearConversations(): Promise<void>;
  handleStreamEnvelope(envelope: AgentStreamEnvelope): void;
  dispose(): void;
}>;

export function shouldFollowConversationAfterAction(
  wasFollowing: boolean,
  actionConversationId: string | null,
  activeConversationId: string | null,
): boolean {
  return wasFollowing && actionConversationId === activeConversationId;
}

export function createAgentController(
  adapter: AgentDesktopAdapter,
  options: ControllerOptions = {},
): AgentController {
  const randomId = options.randomId ?? (() => crypto.randomUUID());
  const now = options.now ?? (() => new Date().toISOString());
  const schedule = options.schedule ?? ((callback, delayMs) => void setTimeout(callback, delayMs));
  let conversations: AgentConversationSummary[] = [];
  let quickActions: AgentQuickAction[] = [];
  let activeConversationId: string | null = null;
  let pendingConversationId: string | null = null;
  const conversationViews = new Map<string, AgentConversationViewState>();
  const pendingRunEvents = new Map<string, AgentRunEvent[]>();
  let loading = true;
  let starting = false;
  let stoppingRunId: string | null = null;
  let retryingRunId: string | null = null;
  let clarificationSubmitting = false;
  let deleting = false;
  let pageErrorMessage = '';
  let unsubscribeStream: (() => void) | null = null;
  let disposed = false;
  const listeners = new Set<(state: AgentControllerState) => void>();

  const snapshot = (): AgentControllerState => ({
    conversations,
    quickActions,
    activeConversationId,
    pendingConversationId,
    conversationViews: new Map(conversationViews),
    loading,
    starting,
    stoppingRunId,
    retryingRunId,
    clarificationSubmitting,
    deleting,
    pageErrorMessage,
  });
  const emit = (): void => {
    if (disposed) return;
    const state = snapshot();
    for (const listener of listeners) listener(state);
  };
  const activeView = (): AgentConversationViewState | null =>
    activeConversationId ? (conversationViews.get(activeConversationId) ?? null) : null;
  const refreshConversations = async (): Promise<void> => {
    if (disposed) return;
    const refreshed = await adapter.listConversations();
    if (disposed) return;
    conversations = refreshed;
    emit();
  };

  const handleRunEvent = (event: AgentRunEvent): void => {
    if (disposed) return;
    const view = conversationViews.get(event.conversationId);
    if (!view || view.activeRunId !== event.runId) {
      if (pendingRunEvents.size >= 16 && !pendingRunEvents.has(event.runId)) return;
      const events = pendingRunEvents.get(event.runId) ?? [];
      pendingRunEvents.set(event.runId, [...events.slice(-511), event]);
      return;
    }
    conversationViews.set(event.conversationId, applyRunEvent(view, event));
    if (
      event.type === 'run_completed' ||
      event.type === 'run_failed' ||
      event.type === 'run_cancelled'
    ) {
      conversations = conversations.map((conversation) =>
        conversation.id === event.conversationId
          ? { ...conversation, activeRunId: null, updatedAt: event.createdAt }
          : conversation,
      );
      void refreshConversations();
      if (event.type === 'run_completed') schedule(() => void refreshConversations(), 1_500);
      if (event.type === 'run_failed') void loadConversation(event.conversationId);
    }
    emit();
  };

  const drainPendingRunEvents = (runId: string): void => {
    const events = pendingRunEvents.get(runId) ?? [];
    pendingRunEvents.delete(runId);
    for (const event of events) handleRunEvent(event);
  };

  const handleStreamEnvelope = (envelope: AgentStreamEnvelope): void => {
    if (disposed) return;
    if (envelope.kind === 'transport_error') {
      const entry = [...conversationViews.entries()].find(
        ([, state]) => state.activeRunId === envelope.runId,
      );
      if (entry) conversationViews.set(entry[0], withConversationError(entry[1], envelope.message));
      emit();
      return;
    }
    handleRunEvent(envelope.event);
  };

  async function loadConversation(conversationId: string): Promise<void> {
    if (disposed) return;
    const persisted = await adapter.getConversation(conversationId);
    if (disposed) return;
    conversations = conversations.map((conversation) =>
      conversation.id === conversationId ? persisted.conversation : conversation,
    );
    conversationViews.set(conversationId, hydrateConversationView(persisted));
    if (persisted.activeRun) {
      pendingRunEvents.delete(persisted.activeRun.runId);
      void adapter
        .resumeRun(persisted.activeRun.runId, conversationId, persisted.activeRun.lastEventId)
        .catch(() => {
          const current = conversationViews.get(conversationId);
          if (current) {
            conversationViews.set(
              conversationId,
              withConversationError(current, '实时进度恢复失败，请稍后重新打开会话。'),
            );
            emit();
          }
        });
      drainPendingRunEvents(persisted.activeRun.runId);
    }
    emit();
  }

  async function initialize(): Promise<void> {
    if (disposed) return;
    unsubscribeStream ??= adapter.onStreamEvent(handleStreamEnvelope);
    loading = true;
    pageErrorMessage = '';
    emit();
    try {
      const [loadedQuickActions, loadedConversations] = await Promise.all([
        adapter.quickActions(),
        adapter.listConversations(),
      ]);
      if (disposed) return;
      quickActions = loadedQuickActions;
      conversations = loadedConversations;
      await Promise.all(
        conversations
          .filter((conversation) => conversation.activeRunId !== null)
          .map((conversation) => loadConversation(conversation.id)),
      );
    } catch {
      pageErrorMessage = 'Agent 服务暂时不可用，请确认 server 已启动且当前账号已登录。';
    } finally {
      loading = false;
      emit();
    }
  }

  async function openConversation(conversationId: string): Promise<void> {
    if (conversationId === activeConversationId || conversationId === pendingConversationId) return;
    pageErrorMessage = '';
    const cached = conversationViews.get(conversationId);
    if (cached) {
      pendingConversationId = null;
      activeConversationId = conversationId;
      emit();
      if (cached.errorMessage) void loadConversation(conversationId);
      return;
    }
    pendingConversationId = conversationId;
    emit();
    try {
      await loadConversation(conversationId);
      if (pendingConversationId === conversationId) activeConversationId = conversationId;
    } catch {
      if (pendingConversationId === conversationId) {
        pageErrorMessage = '无法读取该会话，或它不属于当前登录用户。';
      }
    } finally {
      if (pendingConversationId === conversationId) pendingConversationId = null;
      emit();
    }
  }

  async function startRun(request: StartRequest): Promise<boolean> {
    pageErrorMessage = '';
    starting = true;
    emit();
    try {
      let conversationId = activeConversationId;
      if (!conversationId) {
        const conversation = await adapter.createConversation();
        conversations = [conversation, ...conversations];
        activeConversationId = conversation.id;
        conversationId = conversation.id;
        conversationViews.set(conversationId, createEmptyConversationView(conversationId));
      }
      const currentView = conversationViews.get(conversationId);
      if (!currentView) throw new Error('Agent conversation view is unavailable');
      conversationViews.set(conversationId, { ...currentView, errorMessage: '' });
      const started = await adapter.startRun({
        conversationId,
        ...request,
        clientRequestId: randomId(),
      });
      conversationViews.set(conversationId, addStartedRun(currentView, started, now()));
      conversations = conversations.map((conversation) =>
        conversation.id === conversationId
          ? { ...conversation, activeRunId: started.runId }
          : conversation,
      );
      drainPendingRunEvents(started.runId);
      await refreshConversations();
      return true;
    } catch (error) {
      if ('quickActionId' in request && isPendingBusinessExecutionConflict(error)) {
        pageErrorMessage = '当前任务正在等待补充信息，请先确认或取消当前任务。';
        if (activeConversationId) {
          try {
            await loadConversation(activeConversationId);
          } catch {
            pageErrorMessage =
              '当前任务正在等待补充信息，但状态刷新失败；请重新打开会话后确认或取消。';
          }
        }
      } else {
        pageErrorMessage =
          'quickActionId' in request
            ? '快捷操作启动失败，请确认所需酒店 MCP 数据源已配置。'
            : '消息发送失败，请检查登录状态或稍后重试。';
      }
      return false;
    } finally {
      starting = false;
      emit();
    }
  }

  async function retryFailedRun(): Promise<void> {
    const view = activeView();
    const failedRun = view?.executions.at(-1);
    if (
      !activeConversationId ||
      !view ||
      failedRun?.status !== 'failed' ||
      !failedRun.failure?.retryable ||
      view.activeRunId ||
      retryingRunId
    )
      return;
    const conversationId = activeConversationId;
    retryingRunId = failedRun.runId;
    pageErrorMessage = '';
    emit();
    try {
      const started = await adapter.retryRun({
        failedRunId: failedRun.runId,
        clientRequestId: randomId(),
      });
      conversationViews.set(
        conversationId,
        addStartedRun({ ...view, errorMessage: '' }, started, now()),
      );
      conversations = conversations.map((conversation) =>
        conversation.id === conversationId
          ? { ...conversation, activeRunId: started.runId }
          : conversation,
      );
      drainPendingRunEvents(started.runId);
      await refreshConversations();
    } catch {
      pageErrorMessage = '重新执行失败，原执行记录未改变，请稍后再试。';
    } finally {
      retryingRunId = null;
      emit();
    }
  }

  async function cancelActiveRun(): Promise<void> {
    const view = activeView();
    const runId = view?.activeRunId;
    const conversationId = activeConversationId;
    if (!runId || !conversationId || stoppingRunId) return;
    stoppingRunId = runId;
    pageErrorMessage = '';
    emit();
    try {
      await adapter.cancelRun(runId);
      await loadConversation(conversationId);
    } catch {
      pageErrorMessage = '停止当前执行失败，任务仍在继续，请稍后重试。';
    } finally {
      stoppingRunId = null;
      emit();
    }
  }

  async function submitClarification(response: ClarificationResponse): Promise<boolean> {
    const view = activeView();
    const execution = view?.activeBusinessExecution;
    const clarification = execution?.pendingClarification;
    if (!activeConversationId || !view || !execution || !clarification || clarificationSubmitting) {
      return false;
    }
    const conversationId = activeConversationId;
    clarificationSubmitting = true;
    pageErrorMessage = '';
    emit();
    try {
      const started = await adapter.submitClarification({
        businessExecutionId: execution.id,
        interactionId: clarification.interactionId,
        expectedVersion: clarification.version,
        clientRequestId: randomId(),
        ...response,
      });
      conversationViews.set(conversationId, addStartedRun(view, started, now()));
      conversations = conversations.map((conversation) =>
        conversation.id === conversationId
          ? { ...conversation, activeRunId: started.runId }
          : conversation,
      );
      drainPendingRunEvents(started.runId);
      await refreshConversations();
      return true;
    } catch {
      pageErrorMessage = '补充信息提交失败，可能已过期；请刷新会话后重试。';
      return false;
    } finally {
      clarificationSubmitting = false;
      emit();
    }
  }

  async function cancelPendingBusinessExecution(): Promise<void> {
    const view = activeView();
    const execution = view?.activeBusinessExecution;
    const clarification = execution?.pendingClarification;
    if (!activeConversationId || !view || !execution || !clarification || clarificationSubmitting) {
      return;
    }
    const conversationId = activeConversationId;
    clarificationSubmitting = true;
    pageErrorMessage = '';
    emit();
    try {
      const cancelled = await adapter.cancelBusinessExecution(execution.id, clarification.version);
      conversationViews.set(conversationId, {
        ...view,
        messages: [...view.messages, cancelled.userMessage, cancelled.assistantMessage],
        activeBusinessExecution: null,
      });
      await loadConversation(conversationId);
    } catch {
      pageErrorMessage = '取消任务失败，请刷新会话后重试。';
    } finally {
      clarificationSubmitting = false;
      emit();
    }
  }

  async function deleteConversation(conversationId: string): Promise<void> {
    const target = conversations.find((conversation) => conversation.id === conversationId);
    if (!target || deleting || target.activeRunId) return;
    deleting = true;
    pageErrorMessage = '';
    emit();
    try {
      await adapter.deleteConversation(conversationId);
      conversations = conversations.filter((conversation) => conversation.id !== conversationId);
      conversationViews.delete(conversationId);
      if (activeConversationId === conversationId) activeConversationId = null;
    } catch {
      pageErrorMessage = '删除会话失败，请稍后重试。';
    } finally {
      deleting = false;
      emit();
    }
  }

  async function clearConversations(): Promise<void> {
    if (deleting || conversations.some((conversation) => conversation.activeRunId)) return;
    deleting = true;
    pageErrorMessage = '';
    emit();
    try {
      await adapter.clearConversations();
      conversations = [];
      conversationViews.clear();
      activeConversationId = null;
      pendingConversationId = null;
    } catch {
      pageErrorMessage = '清空历史会话失败，请稍后重试。';
    } finally {
      deleting = false;
      emit();
    }
  }

  const controller: AgentController = {
    get state() {
      return snapshot();
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
    initialize,
    startNewConversation() {
      pageErrorMessage = '';
      pendingConversationId = null;
      activeConversationId = null;
      emit();
    },
    openConversation,
    loadConversation,
    startRun,
    async executeQuickAction(action) {
      const view = activeView();
      if (!action.available || starting || view?.activeRunId) return;
      if (view?.activeBusinessExecution) {
        pageErrorMessage = '当前任务正在等待补充信息，请先确认或取消当前任务。';
        emit();
        return;
      }
      await startRun({ quickActionId: action.id });
    },
    retryFailedRun,
    cancelActiveRun,
    submitClarification,
    cancelPendingBusinessExecution,
    deleteConversation,
    clearConversations,
    handleStreamEnvelope,
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeStream?.();
      unsubscribeStream = null;
      listeners.clear();
      pendingRunEvents.clear();
    },
  };
  return controller;
}
