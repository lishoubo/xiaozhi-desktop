<script lang="ts">
  import type {
    AgentConversationSummary,
    AgentExecutionTrace,
    AgentQuickAction,
    AgentQuickActionId,
    AgentRunEvent,
  } from '@hotel-butler/api';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import Hotel from '@lucide/svelte/icons/hotel';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import ListX from '@lucide/svelte/icons/list-x';
  import Plus from '@lucide/svelte/icons/plus';
  import Square from '@lucide/svelte/icons/square';
  import ChartNoAxesCombined from '@lucide/svelte/icons/chart-no-axes-combined';
  import ChartSpline from '@lucide/svelte/icons/chart-spline';
  import CalendarRange from '@lucide/svelte/icons/calendar-range';
  import Columns3 from '@lucide/svelte/icons/columns-3';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import { autoAnimate } from '@formkit/auto-animate';
  import { onMount, tick } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import AgentAvatar from '../components/agent/AgentAvatar.svelte';
  import AgentClarificationCard from '../components/agent/AgentClarificationCard.svelte';
  import AgentExecutionTimeline from '../components/agent/AgentExecutionTimeline.svelte';
  import AgentMarkdown from '../components/agent/AgentMarkdown.svelte';
  import HotelGenerativeUi from '../components/agent/HotelGenerativeUi.svelte';
  import UserAvatar from '../components/agent/UserAvatar.svelte';
  import {
    addStartedRun,
    applyRunEvent,
    createEmptyConversationView,
    hydrateConversationView,
    withConversationError,
    type AgentConversationViewState,
  } from '../agent-conversation-state';
  import {
    AGENT_CHAT_DISPLAY_NAME,
    agentFailureTitle,
    chatUserDisplayName,
    executionForDisplayedMessage,
    formatConversationUpdatedAt,
    isPendingBusinessExecutionConflict,
    messageOwnsPendingClarification,
    shouldDisplayExecutionTrace,
    shouldOfferFailureRetry,
  } from '../agent-presentation';
  import { greetingName } from '../session-greeting.svelte';
  import { shouldFollowAgentViewport } from '../agent-scroll';
  import { LAYOUT_ANIMATION_OPTIONS, PAGE_ENTER_OPTIONS, enter } from '../motion';
  import { Button } from '$lib/components/ui/button';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { Textarea } from '$lib/components/ui/textarea';

  const quickActionPresentation: Record<AgentQuickActionId, { icon: typeof Hotel; tone: string }> =
    {
      yesterday_operating_review: {
        icon: ChartNoAxesCombined,
        tone: 'bg-[#fef0cf] text-[#805600]',
      },
      last_7_days_operating_trend: {
        icon: ChartSpline,
        tone: 'bg-[#3772cf]/10 text-[#285ba8]',
      },
      month_to_date_operating_progress: {
        icon: CalendarRange,
        tone: 'bg-[#f55a3c]/10 text-[#b43c27]',
      },
      channel_operating_comparison: {
        icon: Columns3,
        tone: 'bg-[#00d4a4]/12 text-[#08765f]',
      },
      public_hotel_rates: { icon: Hotel, tone: 'bg-muted text-foreground' },
      hotel_operating_data: { icon: Hotel, tone: 'bg-[#dff2eb] text-[#176548]' },
    };

  let prompt = $state('');
  let currentUserDisplayName = $derived(chatUserDisplayName(greetingName()));
  let conversations = $state.raw<AgentConversationSummary[]>([]);
  let quickActions = $state.raw<AgentQuickAction[]>([]);
  let activeConversationId = $state<string | null>(null);
  let pendingConversationId = $state<string | null>(null);
  const conversationViews = new SvelteMap<string, AgentConversationViewState>();
  let loading = $state(true);
  let starting = $state(false);
  let stoppingRunId = $state<string | null>(null);
  let retryingRunId = $state<string | null>(null);
  let clarificationSubmitting = $state(false);
  let pageErrorMessage = $state('');
  let deleteTarget = $state.raw<AgentConversationSummary | null>(null);
  let clearHistoryOpen = $state(false);
  let deleting = $state(false);
  let composer = $state<HTMLTextAreaElement | null>(null);
  let conversationViewport = $state<HTMLElement | null>(null);
  let conversationContent = $state<HTMLElement | null>(null);
  let conversationBottomAnchor = $state<HTMLElement | null>(null);
  let followLatestContent = true;
  let lastConversationScrollTop = 0;
  const pendingRunEvents = new SvelteMap<string, AgentRunEvent[]>();

  const activeView = $derived(
    activeConversationId ? (conversationViews.get(activeConversationId) ?? null) : null,
  );
  const messages = $derived(activeView?.messages ?? []);
  const executions = $derived(activeView?.executions ?? []);
  const activeRunId = $derived(activeView?.activeRunId ?? null);
  const draftContent = $derived(activeView?.draftContent ?? '');
  const draftUi = $derived(activeView?.draftUi ?? null);
  const sending = $derived(starting || activeRunId !== null);
  const stopping = $derived(activeRunId !== null && stoppingRunId === activeRunId);
  const latestFailure = $derived.by(() => {
    const execution = executions.at(-1);
    return execution?.status === 'failed' && execution.failure ? execution : null;
  });
  const errorMessage = $derived(
    pageErrorMessage || activeView?.errorMessage || latestFailure?.failure?.message || '',
  );
  const errorTitle = $derived(
    pageErrorMessage
      ? '暂时无法完成操作'
      : latestFailure?.failure
        ? agentFailureTitle(latestFailure.failure.code)
        : '本次任务未完成',
  );
  const activeBusinessExecution = $derived(activeView?.activeBusinessExecution ?? null);
  const pendingClarification = $derived(activeBusinessExecution?.pendingClarification ?? null);
  const quickActionsBlocked = $derived(activeBusinessExecution !== null);
  const hasActiveRuns = $derived(conversations.some((conversation) => conversation.activeRunId));
  const activeConversation = $derived(
    conversations.find((conversation) => conversation.id === activeConversationId) ?? null,
  );
  const quickActionCards = $derived(
    quickActions.map((action) => ({ ...action, ...quickActionPresentation[action.id] })),
  );
  onMount(() => {
    const unsubscribe = window.hotelButler.agent.onStreamEvent(handleStreamEnvelope);
    void initialize();
    return () => {
      unsubscribe();
    };
  });

  $effect(() => {
    const content = conversationContent;
    if (!content) return;
    let pendingFrame: number | null = null;
    const observer = new ResizeObserver(() => {
      if (!followLatestContent || pendingFrame !== null) return;
      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = null;
        scrollConversationToBottom();
      });
    });
    observer.observe(content);
    return () => {
      observer.disconnect();
      if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
    };
  });

  function scrollConversationToBottom(): void {
    const viewport = conversationViewport;
    const anchor = conversationBottomAnchor;
    if (!viewport || !anchor) return;
    anchor.scrollIntoView({ block: 'end' });
    viewport.scrollTop = viewport.scrollHeight;
    lastConversationScrollTop = viewport.scrollTop;
  }

  function handleConversationScroll(): void {
    const viewport = conversationViewport;
    if (!viewport) return;
    followLatestContent = shouldFollowAgentViewport(
      viewport,
      lastConversationScrollTop,
      followLatestContent,
    );
    lastConversationScrollTop = viewport.scrollTop;
  }

  async function activateConversation(conversationId: string): Promise<void> {
    followLatestContent = true;
    lastConversationScrollTop = 0;
    activeConversationId = conversationId;
    await tick();
    if (activeConversationId === conversationId) scrollConversationToBottom();
  }

  async function initialize(): Promise<void> {
    loading = true;
    pageErrorMessage = '';
    try {
      const [nextQuickActions, nextConversations] = await Promise.all([
        window.hotelButler.agent.quickActions(),
        window.hotelButler.agent.listConversations(),
      ]);
      quickActions = nextQuickActions;
      conversations = nextConversations;
      await Promise.all(
        nextConversations
          .filter((conversation) => conversation.activeRunId !== null)
          .map((conversation) => loadConversationState(conversation.id)),
      );
    } catch {
      pageErrorMessage = 'Agent 服务暂时不可用，请确认 server 已启动且当前账号已登录。';
    } finally {
      loading = false;
    }
  }

  async function refreshConversations(): Promise<void> {
    conversations = await window.hotelButler.agent.listConversations();
  }

  function startNewConversation(): void {
    pageErrorMessage = '';
    pendingConversationId = null;
    activeConversationId = null;
    followLatestContent = true;
    lastConversationScrollTop = 0;
    composer?.focus();
  }

  function resetActiveConversation(): void {
    pageErrorMessage = '';
    pendingConversationId = null;
    activeConversationId = null;
    followLatestContent = true;
    lastConversationScrollTop = 0;
  }

  async function confirmDeleteConversation(): Promise<void> {
    const target = deleteTarget;
    if (!target || deleting || target.activeRunId) return;
    deleting = true;
    pageErrorMessage = '';
    try {
      await window.hotelButler.agent.deleteConversation(target.id);
      conversations = conversations.filter((conversation) => conversation.id !== target.id);
      conversationViews.delete(target.id);
      if (activeConversationId === target.id) resetActiveConversation();
      deleteTarget = null;
    } catch {
      pageErrorMessage = '删除会话失败，请稍后重试。';
    } finally {
      deleting = false;
    }
  }

  async function confirmClearConversations(): Promise<void> {
    if (deleting || hasActiveRuns) return;
    deleting = true;
    pageErrorMessage = '';
    try {
      await window.hotelButler.agent.clearConversations();
      conversations = [];
      conversationViews.clear();
      resetActiveConversation();
      clearHistoryOpen = false;
    } catch {
      pageErrorMessage = '清空历史会话失败，请稍后重试。';
    } finally {
      deleting = false;
    }
  }

  async function openConversation(conversationId: string): Promise<void> {
    if (conversationId === activeConversationId || conversationId === pendingConversationId) return;
    pageErrorMessage = '';
    const cached = conversationViews.get(conversationId);
    if (cached) {
      pendingConversationId = null;
      await activateConversation(conversationId);
      if (cached.errorMessage) void loadConversationState(conversationId);
      return;
    }
    pendingConversationId = conversationId;
    try {
      await loadConversationState(conversationId);
      if (pendingConversationId === conversationId) await activateConversation(conversationId);
    } catch {
      if (pendingConversationId === conversationId) {
        pageErrorMessage = '无法读取该会话，或它不属于当前登录用户。';
      }
    } finally {
      if (pendingConversationId === conversationId) pendingConversationId = null;
    }
  }

  async function loadConversationState(conversationId: string): Promise<void> {
    const snapshot = await window.hotelButler.agent.getConversation(conversationId);
    conversations = conversations.map((conversation) =>
      conversation.id === conversationId ? snapshot.conversation : conversation,
    );
    const view = hydrateConversationView(snapshot);
    conversationViews.set(conversationId, view);
    if (!snapshot.activeRun) {
      return;
    }
    pendingRunEvents.delete(snapshot.activeRun.runId);
    void window.hotelButler.agent
      .resumeRun(snapshot.activeRun.runId, conversationId, snapshot.activeRun.lastEventId)
      .catch(() => {
        const current = conversationViews.get(conversationId);
        if (current) {
          conversationViews.set(
            conversationId,
            withConversationError(current, '实时进度恢复失败，请稍后重新打开会话。'),
          );
        }
      });
    drainPendingRunEvents(snapshot.activeRun.runId);
  }

  async function cancelActiveRun(): Promise<void> {
    const runId = activeRunId;
    const conversationId = activeConversationId;
    if (!runId || !conversationId || stoppingRunId) return;
    const shouldFollow = followLatestContent;
    stoppingRunId = runId;
    pageErrorMessage = '';
    try {
      await window.hotelButler.agent.cancelRun(runId);
      await loadConversationState(conversationId);
      if (shouldFollow && activeConversationId === conversationId) {
        followLatestContent = true;
        await tick();
        scrollConversationToBottom();
      }
      composer?.focus();
    } catch {
      pageErrorMessage = '停止当前执行失败，任务仍在继续，请稍后重试。';
    } finally {
      stoppingRunId = null;
    }
  }

  async function retryFailedRun(): Promise<void> {
    const conversationId = activeConversationId;
    const failedRun = latestFailure;
    if (!conversationId || !failedRun?.failure?.retryable || activeRunId || retryingRunId) return;
    retryingRunId = failedRun.runId;
    pageErrorMessage = '';
    try {
      const currentView = conversationViews.get(conversationId);
      if (!currentView) throw new Error('Agent conversation view is unavailable');
      const started = await window.hotelButler.agent.retryRun({
        failedRunId: failedRun.runId,
        clientRequestId: crypto.randomUUID(),
      });
      conversationViews.set(
        conversationId,
        addStartedRun({ ...currentView, errorMessage: '' }, started, new Date().toISOString()),
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
    }
  }

  async function submitPrompt(): Promise<void> {
    const content = prompt.trim();
    if (!content || sending) return;
    prompt = '';
    if (pendingClarification && activeBusinessExecution) {
      await submitClarification({ responseText: content }, content);
      return;
    }
    await startRun({ prompt: content }, content);
  }

  async function submitClarification(
    response:
      | { responseText: string }
      | { answers: Readonly<Record<string, string | number | { start: string; end: string }>> },
    restorePrompt = '',
  ): Promise<void> {
    const conversationId = activeConversationId;
    const execution = activeBusinessExecution;
    const clarification = pendingClarification;
    if (!conversationId || !execution || !clarification || clarificationSubmitting) return;
    clarificationSubmitting = true;
    followLatestContent = true;
    pageErrorMessage = '';
    try {
      const currentView = conversationViews.get(conversationId);
      if (!currentView) throw new Error('Agent conversation view is unavailable');
      const started = await window.hotelButler.agent.submitClarification({
        businessExecutionId: execution.id,
        interactionId: clarification.interactionId,
        expectedVersion: clarification.version,
        clientRequestId: crypto.randomUUID(),
        ...response,
      });
      conversationViews.set(
        conversationId,
        addStartedRun(currentView, started, new Date().toISOString()),
      );
      conversations = conversations.map((conversation) =>
        conversation.id === conversationId
          ? { ...conversation, activeRunId: started.runId }
          : conversation,
      );
      drainPendingRunEvents(started.runId);
      await refreshConversations();
    } catch {
      if (restorePrompt) prompt = restorePrompt;
      pageErrorMessage = '补充信息提交失败，可能已过期；请刷新会话后重试。';
    } finally {
      clarificationSubmitting = false;
    }
  }

  async function cancelPendingBusinessExecution(): Promise<void> {
    const conversationId = activeConversationId;
    const execution = activeBusinessExecution;
    const clarification = pendingClarification;
    if (!conversationId || !execution || !clarification || clarificationSubmitting) return;
    clarificationSubmitting = true;
    followLatestContent = true;
    pageErrorMessage = '';
    try {
      const cancelled = await window.hotelButler.agent.cancelBusinessExecution(
        execution.id,
        clarification.version,
      );
      const currentView = conversationViews.get(conversationId);
      if (currentView) {
        conversationViews.set(conversationId, {
          ...currentView,
          messages: [...currentView.messages, cancelled.userMessage, cancelled.assistantMessage],
          activeBusinessExecution: null,
        });
      }
      await loadConversationState(conversationId);
    } catch {
      pageErrorMessage = '取消任务失败，请刷新会话后重试。';
    } finally {
      clarificationSubmitting = false;
    }
  }

  async function executeQuickAction(action: AgentQuickAction): Promise<void> {
    if (!action.available || sending) return;
    if (quickActionsBlocked) {
      pageErrorMessage = '当前任务正在等待补充信息，请先确认或取消当前任务。';
      return;
    }
    await startRun({ quickActionId: action.id });
  }

  async function startRun(
    request: { prompt: string } | { quickActionId: AgentQuickActionId },
    restorePrompt = '',
  ): Promise<void> {
    pageErrorMessage = '';
    starting = true;
    followLatestContent = true;

    try {
      let conversationId = activeConversationId;
      if (!conversationId) {
        const conversation = await window.hotelButler.agent.createConversation();
        conversations = [conversation, ...conversations];
        await activateConversation(conversation.id);
        conversationId = conversation.id;
        conversationViews.set(conversationId, createEmptyConversationView(conversationId));
      }
      const currentView = conversationViews.get(conversationId);
      if (!currentView) throw new Error('Agent conversation view is unavailable');
      conversationViews.set(conversationId, { ...currentView, errorMessage: '' });
      const started = await window.hotelButler.agent.startRun({
        conversationId,
        ...request,
        clientRequestId: crypto.randomUUID(),
      });
      conversationViews.set(
        conversationId,
        addStartedRun(currentView, started, new Date().toISOString()),
      );
      conversations = conversations.map((conversation) =>
        conversation.id === conversationId
          ? { ...conversation, activeRunId: started.runId }
          : conversation,
      );
      drainPendingRunEvents(started.runId);
      await refreshConversations();
    } catch (error) {
      if (restorePrompt) prompt = restorePrompt;
      if ('quickActionId' in request && isPendingBusinessExecutionConflict(error)) {
        pageErrorMessage = '当前任务正在等待补充信息，请先确认或取消当前任务。';
        if (activeConversationId) {
          try {
            await loadConversationState(activeConversationId);
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
    } finally {
      starting = false;
    }
  }

  function handleStreamEnvelope(
    envelope: Parameters<Parameters<typeof window.hotelButler.agent.onStreamEvent>[0]>[0],
  ): void {
    if (envelope.kind === 'transport_error') {
      const entry = [...conversationViews.entries()].find(
        ([, state]) => state.activeRunId === envelope.runId,
      );
      if (entry) conversationViews.set(entry[0], withConversationError(entry[1], envelope.message));
      return;
    }
    handleRunEvent(envelope.event);
  }

  function handleRunEvent(event: AgentRunEvent): void {
    const view = conversationViews.get(event.conversationId);
    if (!view || view.activeRunId !== event.runId) {
      bufferRunEvent(event);
      return;
    }
    const shouldFollowAfterRender = followLatestContent;
    conversationViews.set(event.conversationId, applyRunEvent(view, event));
    if (shouldFollowAfterRender) {
      void tick().then(() => {
        followLatestContent = true;
        scrollConversationToBottom();
      });
    }
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
      if (event.type === 'run_completed') {
        setTimeout(() => void refreshConversations(), 1_500);
      }
      if (event.type === 'run_failed') void loadConversationState(event.conversationId);
    }
  }

  function bufferRunEvent(event: AgentRunEvent): void {
    if (pendingRunEvents.size >= 16 && !pendingRunEvents.has(event.runId)) return;
    const events = pendingRunEvents.get(event.runId) ?? [];
    pendingRunEvents.set(event.runId, [...events.slice(-511), event]);
  }

  function drainPendingRunEvents(runId: string): void {
    const events = pendingRunEvents.get(runId) ?? [];
    pendingRunEvents.delete(runId);
    for (const event of events) handleRunEvent(event);
  }

  function activeExecution(): AgentExecutionTrace | null {
    return executions.find((execution) => execution.runId === activeRunId) ?? null;
  }

  function handleComposerKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submitPrompt();
    }
  }
</script>

<div
  class="grid h-full min-h-0 grid-cols-[204px_minmax(0,1fr)] bg-background"
  data-motion="page"
  in:enter={PAGE_ENTER_OPTIONS}
>
  <aside class="flex min-h-0 flex-col border-r border-border/70 bg-muted/35 px-2.5 py-3">
    <Button
      class="w-full justify-start rounded-lg text-[13px] shadow-sm transition-[background-color,border-color,box-shadow] duration-200 ease-out"
      variant={activeConversationId === null ? 'default' : 'outline'}
      aria-label="开始新会话"
      aria-pressed={activeConversationId === null}
      onclick={() => void startNewConversation()}
    >
      <Plus size={16} />
      新会话
    </Button>

    <div
      class="mt-5 min-h-0 flex-1 overflow-y-auto pr-0.5"
      use:autoAnimate={LAYOUT_ANIMATION_OPTIONS}
    >
      <div class="flex items-center justify-between px-2">
        <p class="m-0 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground/75">
          历史会话
        </p>
        {#if conversations.length > 0}
          <button
            class="grid size-6 place-items-center rounded-md text-muted-foreground/75 transition-colors hover:bg-destructive/8 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            type="button"
            aria-label="清空"
            title="清空全部历史会话"
            disabled={hasActiveRuns || deleting}
            onclick={() => (clearHistoryOpen = true)}><ListX size={14} /></button
          >
        {/if}
      </div>
      {#if conversations.length === 0 && !loading}
        <p class="px-2 py-3 text-xs leading-5 text-muted-foreground">暂无历史会话</p>
      {/if}
      {#each conversations as conversation (conversation.id)}
        <div
          class={[
            'group/history relative mt-0.5 rounded-lg border transition-[background-color,border-color,box-shadow,color,transform] duration-200 ease-out motion-reduce:transform-none',
            conversation.id === activeConversationId
              ? 'border-border/70 bg-background text-foreground shadow-sm'
              : 'border-transparent text-muted-foreground hover:translate-x-0.5 hover:bg-background/70 hover:text-foreground',
          ]}
        >
          {#if conversation.id === activeConversationId}
            <span class="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-[var(--brand-green)]"
            ></span>
          {/if}
          <button
            class="w-full rounded-lg py-2 pr-8 pl-2.5 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            type="button"
            aria-label={conversation.title}
            aria-pressed={conversation.id === activeConversationId}
            onclick={() => void openConversation(conversation.id)}
          >
            <span class="line-clamp-2 text-[13px] leading-5 font-medium">{conversation.title}</span>
            <span
              class="mt-0.5 flex items-center gap-1.5 text-[10px] leading-4 text-muted-foreground/70"
            >
              {#if conversation.id === pendingConversationId}
                <span
                  class="inline-flex items-center gap-1 font-medium text-[var(--brand-green-deep)]"
                >
                  <LoaderCircle class="animate-spin" size={11} />正在读取
                </span>
              {:else if conversation.activeRunId}
                <span
                  class="inline-flex items-center gap-1 font-medium text-[var(--brand-green-deep)]"
                >
                  <span class="size-1.5 animate-pulse rounded-full bg-[var(--brand-green)]"
                  ></span>运行中
                </span>
              {:else}
                {formatConversationUpdatedAt(conversation.updatedAt)}
              {/if}
            </span>
          </button>
          <button
            class="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground opacity-0 transition-[color,background-color,opacity] hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none group-hover/history:opacity-100 group-focus-within/history:opacity-100"
            type="button"
            aria-label={`删除会话：${conversation.title}`}
            disabled={conversation.activeRunId !== null || deleting}
            title={conversation.activeRunId ? '运行中的会话不能删除' : '删除会话'}
            onclick={() => (deleteTarget = conversation)}
          >
            <Trash2 size={13} />
          </button>
        </div>
      {/each}
    </div>
  </aside>

  <main class="flex min-h-0 min-w-0 flex-col">
    <header
      class="flex h-[64px] shrink-0 items-center justify-between border-b border-border/70 bg-background px-6"
    >
      <div class="group/agent flex min-w-0 flex-1 items-center gap-3">
        <AgentAvatar online />
        <div class="min-w-0">
          <p class="m-0 text-[10px] font-medium tracking-[0.08em] text-muted-foreground">
            小智 AI 管家
          </p>
          <h1 class="m-0 mt-0.5 max-w-full truncate text-sm font-semibold">
            {activeConversation?.title ?? '新会话'}
          </h1>
        </div>
      </div>
      {#if sending}
        <span class="ml-3 inline-flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircle class="animate-spin" size={14} />正在处理
        </span>
      {/if}
    </header>

    <section
      bind:this={conversationViewport}
      class="min-h-0 flex-1 overflow-y-auto bg-muted/20"
      aria-label="对话内容"
      aria-live="polite"
      onscroll={handleConversationScroll}
    >
      <div
        bind:this={conversationContent}
        class="mx-auto w-full max-w-[1280px] px-6 py-8 sm:px-8 lg:px-10"
      >
        {#if loading}
          <div class="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
            <LoaderCircle class="animate-spin" size={18} />正在读取会话
          </div>
        {:else if messages.length === 0 && !sending}
          <div
            class="mx-auto flex max-w-2xl flex-col items-center pt-[clamp(40px,8vh,80px)] text-center"
          >
            <AgentAvatar size="lg" online motion="float" />
            <h2 class="mt-5 mb-0 text-2xl font-semibold tracking-[-0.02em]">今天想处理什么？</h2>
            <div class="mt-7 grid w-full grid-cols-2 gap-2.5 lg:grid-cols-3">
              {#each quickActionCards.slice(0, 6) as action (action.id)}
                <button
                  class={[
                    'group rounded-lg border border-border bg-card px-3.5 py-3 text-left transition-[background-color,border-color,box-shadow,transform] duration-200 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transform-none',
                    action.available
                      ? 'hover:-translate-y-0.5 hover:border-input hover:shadow-md'
                      : 'cursor-not-allowed opacity-60',
                  ]}
                  type="button"
                  disabled={!action.available || sending}
                  title={action.description}
                  onclick={() => void executeQuickAction(action)}
                >
                  <span class={['mb-3 grid size-8 place-items-center rounded-lg', action.tone]}>
                    <action.icon size={17} />
                  </span>
                  <span class="block text-xs font-medium">{action.label}</span>
                  {#if !action.available}
                    <span class="mt-2 block text-[11px] font-medium text-amber-700"
                      >需配置酒店 MCP</span
                    >
                  {/if}
                </button>
              {/each}
            </div>
          </div>
        {/if}

        {#each messages as message (message.id)}
          {@const execution = executionForDisplayedMessage(executions, message)}
          <article
            class="mt-6"
            data-agent-message-id={message.id}
            data-agent-message-role={message.role}
          >
            <div
              class={[
                'mx-auto flex w-full max-w-4xl gap-3',
                message.role === 'user' ? 'justify-end' : '',
              ]}
            >
              {#if message.role === 'assistant'}<AgentAvatar size="sm" />{/if}
              <div
                class={[
                  'min-w-0',
                  message.role === 'assistant' ? 'flex-1' : 'max-w-[82%] overflow-hidden',
                ]}
              >
                <p
                  class={[
                    'mt-0 mb-2 text-xs font-semibold text-muted-foreground',
                    message.role === 'user' ? 'text-right' : 'text-left',
                  ]}
                >
                  {message.role === 'assistant' ? AGENT_CHAT_DISPLAY_NAME : currentUserDisplayName}
                </p>
                {#if execution && message.role === 'assistant' && shouldDisplayExecutionTrace(execution)}
                  <div class="max-w-2xl">
                    <AgentExecutionTimeline trace={execution} />
                  </div>
                {/if}
                {#if message.content && message.role === 'assistant'}
                  <div
                    class={[
                      'w-full',
                      execution && shouldDisplayExecutionTrace(execution) ? 'mt-5' : '',
                    ]}
                  >
                    <AgentMarkdown content={message.content} />
                  </div>
                {:else if message.content}
                  <p
                    class="m-0 break-words whitespace-pre-wrap rounded-xl bg-secondary px-4 py-3 text-sm leading-7 transition-colors duration-200 ease-out [overflow-wrap:anywhere]"
                  >
                    {message.content}
                  </p>
                {/if}
                {#if message.ui}
                  <div class="mt-5 w-full">
                    <HotelGenerativeUi spec={message.ui} />
                  </div>
                {/if}
                {#if pendingClarification && messageOwnsPendingClarification(activeBusinessExecution, message, messages)}
                  <AgentClarificationCard
                    clarification={pendingClarification}
                    submitting={clarificationSubmitting}
                    onsubmit={(answers) => void submitClarification({ answers })}
                    oncancel={() => void cancelPendingBusinessExecution()}
                  />
                {/if}
              </div>
              {#if message.role === 'user'}<UserAvatar name={currentUserDisplayName} />{/if}
            </div>
          </article>
          {#if execution && message.role === 'user' && shouldDisplayExecutionTrace(execution)}
            <article
              class="mx-auto mt-3 flex w-full max-w-4xl gap-3"
              data-agent-execution-for-message={message.id}
            >
              <AgentAvatar size="sm" />
              <div class="min-w-0 flex-1">
                <p class="mt-0 mb-2 text-xs font-semibold text-muted-foreground">
                  {AGENT_CHAT_DISPLAY_NAME}
                </p>
                <div class="max-w-2xl">
                  <AgentExecutionTimeline trace={execution} />
                </div>
              </div>
            </article>
          {/if}
        {/each}

        {#if sending || draftContent || draftUi}
          {@const execution = activeExecution()}
          <article class="mt-6">
            <div class="mx-auto flex w-full max-w-4xl gap-3">
              <AgentAvatar size="sm" />
              <div class="min-w-0 flex-1">
                <p class="mt-0 mb-2 text-xs font-semibold text-muted-foreground">
                  {AGENT_CHAT_DISPLAY_NAME}
                </p>
                {#if execution && shouldDisplayExecutionTrace(execution)}
                  <div class="max-w-2xl">
                    <AgentExecutionTimeline trace={execution} />
                  </div>
                {/if}
                {#if draftContent}
                  <div
                    class={[
                      'w-full',
                      execution && shouldDisplayExecutionTrace(execution) ? 'mt-5' : '',
                    ]}
                  >
                    <AgentMarkdown content={draftContent} />
                  </div>
                {:else}
                  <p
                    class={[
                      'mb-0 inline-flex items-center gap-2 text-sm text-muted-foreground',
                      execution && shouldDisplayExecutionTrace(execution) ? 'mt-5' : 'mt-2',
                    ]}
                  >
                    <LoaderCircle class="animate-spin" size={15} />正在理解任务…
                  </p>
                {/if}
                {#if draftUi}
                  <div class="mt-5 w-full">
                    <HotelGenerativeUi spec={draftUi} />
                  </div>
                {/if}
              </div>
            </div>
          </article>
        {/if}

        {#if errorMessage}
          <div
            class="mx-auto mt-6 flex w-full max-w-4xl flex-wrap items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive sm:flex-nowrap sm:items-center"
          >
            <TriangleAlert class="mt-0.5 shrink-0 sm:mt-0" size={16} />
            <div class="min-w-0 flex-1">
              <p class="m-0 font-medium">{errorTitle}</p>
              <p class="mt-0.5 mb-0 break-words text-destructive/85 [overflow-wrap:anywhere]">
                {errorMessage}
              </p>
            </div>
            {#if !pageErrorMessage && shouldOfferFailureRetry(latestFailure?.failure ?? null) && !activeRunId}
              <Button
                class="ml-auto shrink-0"
                size="sm"
                variant="outline"
                disabled={retryingRunId !== null}
                onclick={() => void retryFailedRun()}
              >
                {#if retryingRunId}<LoaderCircle class="animate-spin" />{/if}
                重新尝试
              </Button>
            {/if}
          </div>
        {/if}
        <div bind:this={conversationBottomAnchor} class="h-px" aria-hidden="true"></div>
      </div>
    </section>

    <footer class="shrink-0 border-t border-border/60 bg-background/95 px-6 pt-3 pb-4">
      <div class="mx-auto w-full max-w-4xl">
        {#if quickActionCards.length > 0 && messages.length > 0}
          <div class="mb-2 flex flex-wrap items-center gap-1.5" aria-label="酒店快捷操作">
            {#each quickActionCards as action (action.id)}
              <button
                class={[
                  'inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] leading-4 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  action.available
                    ? 'text-foreground hover:border-input hover:bg-muted'
                    : 'cursor-not-allowed text-muted-foreground opacity-60',
                ]}
                type="button"
                disabled={!action.available || sending}
                title={action.available
                  ? action.description
                  : `${action.description}（需配置酒店 MCP）`}
                onclick={() => void executeQuickAction(action)}
              >
                <action.icon size={12} />
                {action.label}
                {#if !action.available}<span class="text-[10px]">需 MCP</span>{/if}
              </button>
            {/each}
          </div>
        {/if}
        <div
          class="rounded-lg border border-input bg-background p-2 shadow-md focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20"
        >
          <Textarea
            class="min-h-14 resize-none border-0 px-2 py-2.5 shadow-none focus-visible:ring-0"
            bind:ref={composer}
            bind:value={prompt}
            aria-label="给小智 AI 管家发消息"
            placeholder="问小智酒店运营问题…"
            disabled={sending}
            onkeydown={handleComposerKeydown}
          />
          <div class="flex min-w-0 items-center justify-between gap-2 px-1">
            <span class="min-w-0 truncate text-[10px] text-muted-foreground"
              >Enter 发送 · Shift+Enter 换行</span
            >
            {#if sending}
              <Button
                size="icon-sm"
                variant="outline"
                disabled={!activeRunId || stopping}
                aria-label={stopping ? '正在停止' : activeRunId ? '停止执行' : '正在准备执行'}
                onclick={() => void cancelActiveRun()}
                >{#if stopping || !activeRunId}<LoaderCircle class="animate-spin" />{:else}<Square
                  />{/if}</Button
              >
            {:else}
              <Button
                size="icon-sm"
                aria-label="发送消息"
                disabled={!prompt.trim()}
                onclick={() => void submitPrompt()}><ArrowUp /></Button
              >
            {/if}
          </div>
        </div>
      </div>
    </footer>
  </main>
</div>

<AlertDialog.Root
  open={deleteTarget !== null}
  onOpenChange={(next) => !next && !deleting && (deleteTarget = null)}
>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>删除这次会话？</AlertDialog.Title>
      <AlertDialog.Description>删除后无法恢复，长期记忆不受影响。</AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel disabled={deleting}>取消</AlertDialog.Cancel>
      <AlertDialog.Action
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        disabled={deleting}
        onclick={() => void confirmDeleteConversation()}>删除</AlertDialog.Action
      >
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root
  open={clearHistoryOpen}
  onOpenChange={(next) => !next && !deleting && (clearHistoryOpen = false)}
>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>清空全部历史会话？</AlertDialog.Title>
      <AlertDialog.Description>
        当前账号的 {conversations.length} 次会话及其消息和执行记录将永久删除，长期记忆不受影响。
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel disabled={deleting}>取消</AlertDialog.Cancel>
      <AlertDialog.Action
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        disabled={deleting}
        onclick={() => void confirmClearConversations()}
      >
        {#if deleting}<LoaderCircle class="animate-spin" size={14} />正在清空{:else}全部清空{/if}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
