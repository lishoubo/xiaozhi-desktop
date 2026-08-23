<script lang="ts">
  import type {
    AgentConversationSummary,
    AgentExecutionTrace,
    AgentQuickAction,
    AgentQuickActionId,
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
  import AgentAvatar from '../components/agent/AgentAvatar.svelte';
  import AgentClarificationCard from '../components/agent/AgentClarificationCard.svelte';
  import AgentExecutionTimeline from '../components/agent/AgentExecutionTimeline.svelte';
  import AgentMarkdown from '../components/agent/AgentMarkdown.svelte';
  import HotelGenerativeUi from '../components/agent/HotelGenerativeUi.svelte';
  import UserAvatar from '../components/agent/UserAvatar.svelte';
  import {
    createAgentController,
    shouldFollowConversationAfterAction,
  } from '../agent-controller';
  import {
    AGENT_CHAT_DISPLAY_NAME,
    agentFailureTitle,
    chatUserDisplayName,
    executionForDisplayedMessage,
    formatConversationUpdatedAt,
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
  const controller = createAgentController(window.hotelButler.agent);
  let controllerState = $state.raw(controller.state);
  const conversations = $derived(controllerState.conversations);
  const quickActions = $derived(controllerState.quickActions);
  const activeConversationId = $derived(controllerState.activeConversationId);
  const pendingConversationId = $derived(controllerState.pendingConversationId);
  const conversationViews = $derived(controllerState.conversationViews);
  const loading = $derived(controllerState.loading);
  const starting = $derived(controllerState.starting);
  const stoppingRunId = $derived(controllerState.stoppingRunId);
  const retryingRunId = $derived(controllerState.retryingRunId);
  const clarificationSubmitting = $derived(controllerState.clarificationSubmitting);
  const pageErrorMessage = $derived(controllerState.pageErrorMessage);
  const deleting = $derived(controllerState.deleting);
  let deleteTarget = $state.raw<AgentConversationSummary | null>(null);
  let clearHistoryOpen = $state(false);
  let composer = $state<HTMLTextAreaElement | null>(null);
  let conversationViewport = $state<HTMLElement | null>(null);
  let conversationContent = $state<HTMLElement | null>(null);
  let conversationBottomAnchor = $state<HTMLElement | null>(null);
  let followLatestContent = true;
  let lastConversationScrollTop = 0;

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
  const hasActiveRuns = $derived(conversations.some((conversation) => conversation.activeRunId));
  const activeConversation = $derived(
    conversations.find((conversation) => conversation.id === activeConversationId) ?? null,
  );
  const quickActionCards = $derived(
    quickActions.map((action) => ({ ...action, ...quickActionPresentation[action.id] })),
  );
  onMount(() => {
    const unsubscribe = controller.subscribe((state) => {
      controllerState = state;
      if (followLatestContent) {
        void tick().then(() => {
          if (followLatestContent) scrollConversationToBottom();
        });
      }
    });
    void controller.initialize();
    return () => {
      unsubscribe();
      controller.dispose();
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
        if (followLatestContent) scrollConversationToBottom();
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

  function startNewConversation(): void {
    controller.startNewConversation();
    followLatestContent = true;
    lastConversationScrollTop = 0;
    composer?.focus();
  }

  async function openConversation(conversationId: string): Promise<void> {
    followLatestContent = true;
    lastConversationScrollTop = 0;
    await controller.openConversation(conversationId);
    if (controller.state.activeConversationId === conversationId) {
      await tick();
      scrollConversationToBottom();
    }
  }

  async function confirmDeleteConversation(): Promise<void> {
    const target = deleteTarget;
    if (!target) return;
    await controller.deleteConversation(target.id);
    if (!controller.state.conversations.some((conversation) => conversation.id === target.id)) {
      deleteTarget = null;
    }
  }

  async function confirmClearConversations(): Promise<void> {
    await controller.clearConversations();
    if (controller.state.conversations.length === 0) clearHistoryOpen = false;
  }

  async function cancelActiveRun(): Promise<void> {
    const shouldFollow = followLatestContent;
    const conversationId = controller.state.activeConversationId;
    await controller.cancelActiveRun();
    if (
      shouldFollowConversationAfterAction(
        shouldFollow,
        conversationId,
        controller.state.activeConversationId,
      )
    ) {
      followLatestContent = true;
      await tick();
      scrollConversationToBottom();
    }
    composer?.focus();
  }

  function retryFailedRun(): Promise<void> {
    followLatestContent = true;
    return controller.retryFailedRun();
  }

  async function submitPrompt(): Promise<void> {
    const content = prompt.trim();
    if (!content || sending) return;
    prompt = '';
    followLatestContent = true;
    const accepted = pendingClarification
      ? await controller.submitClarification({ responseText: content })
      : await controller.startRun({ prompt: content });
    if (!accepted) prompt = content;
  }

  async function submitClarification(
    response:
      | { responseText: string }
      | { answers: Readonly<Record<string, string | number | { start: string; end: string }>> },
  ): Promise<void> {
    followLatestContent = true;
    await controller.submitClarification(response);
  }

  function cancelPendingBusinessExecution(): Promise<void> {
    followLatestContent = true;
    return controller.cancelPendingBusinessExecution();
  }

  function executeQuickAction(action: AgentQuickAction): Promise<void> {
    followLatestContent = true;
    return controller.executeQuickAction(action);
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
