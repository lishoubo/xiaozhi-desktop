<script lang="ts">
  import type {
    AgentConversationSummary,
    AgentExecutionTrace,
    AgentMessage,
    AgentQuickAction,
    AgentQuickActionId,
    AgentRunEvent,
    GenerativeUiSpec,
  } from '@hotel-butler/api';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import Hotel from '@lucide/svelte/icons/hotel';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import ListX from '@lucide/svelte/icons/list-x';
  import Plus from '@lucide/svelte/icons/plus';
  import Square from '@lucide/svelte/icons/square';
  import Sun from '@lucide/svelte/icons/sun';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import { autoAnimate } from '@formkit/auto-animate';
  import { onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import AgentAvatar from '../components/agent/AgentAvatar.svelte';
  import AgentExecutionTimeline from '../components/agent/AgentExecutionTimeline.svelte';
  import AgentMarkdown from '../components/agent/AgentMarkdown.svelte';
  import HotelGenerativeUi from '../components/agent/HotelGenerativeUi.svelte';
  import { executionForDisplayedMessage, formatConversationUpdatedAt } from '../agent-presentation';
  import {
    LAYOUT_ANIMATION_OPTIONS,
    PAGE_ENTER_OPTIONS,
    SURFACE_TRANSITION_OPTIONS,
    enter,
  } from '../motion';
  import { Button } from '$lib/components/ui/button';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { Textarea } from '$lib/components/ui/textarea';

  const quickActionPresentation: Record<AgentQuickActionId, { icon: typeof Sun; tone: string }> = {
    today_weather: { icon: Sun, tone: 'bg-[#fef7d6] text-[#793400]' },
    public_hotel_rates: { icon: Hotel, tone: 'bg-[#e6e0f5] text-[#3a2a99]' },
    hotel_operating_data: { icon: Hotel, tone: 'bg-[#dff2eb] text-[#176548]' },
  };

  let prompt = $state('');
  let conversations = $state.raw<AgentConversationSummary[]>([]);
  let quickActions = $state.raw<AgentQuickAction[]>([]);
  let activeConversationId = $state<string | null>(null);
  let messages = $state.raw<AgentMessage[]>([]);
  let executions = $state.raw<AgentExecutionTrace[]>([]);
  let activeRunId = $state<string | null>(null);
  let draftContent = $state('');
  let draftUi = $state.raw<GenerativeUiSpec | null>(null);
  let preparingUi = $state(false);
  let loading = $state(true);
  let sending = $state(false);
  let stopping = $state(false);
  let errorMessage = $state('');
  let deleteTarget = $state.raw<AgentConversationSummary | null>(null);
  let clearHistoryOpen = $state(false);
  let deleting = $state(false);
  let composer = $state<HTMLTextAreaElement | null>(null);
  const pendingRunEvents = new SvelteMap<string, AgentRunEvent[]>();

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
      if (activeRunId) void window.hotelButler.agent.cancelRun(activeRunId);
    };
  });

  async function initialize(): Promise<void> {
    loading = true;
    errorMessage = '';
    try {
      const [nextQuickActions, nextConversations] = await Promise.all([
        window.hotelButler.agent.quickActions(),
        window.hotelButler.agent.listConversations(),
      ]);
      quickActions = nextQuickActions;
      conversations = nextConversations;
    } catch {
      errorMessage = 'Agent 服务暂时不可用，请确认 server 已启动且当前账号已登录。';
    } finally {
      loading = false;
    }
  }

  async function refreshConversations(): Promise<void> {
    conversations = await window.hotelButler.agent.listConversations();
  }

  async function startNewConversation(): Promise<void> {
    if (!(await cancelActiveRun())) return;
    resetConversationState();
    composer?.focus();
  }

  function resetConversationState(): void {
    errorMessage = '';
    activeConversationId = null;
    messages = [];
    executions = [];
    draftContent = '';
    draftUi = null;
    preparingUi = false;
  }

  async function confirmDeleteConversation(): Promise<void> {
    const target = deleteTarget;
    if (!target || deleting || sending) return;
    deleting = true;
    errorMessage = '';
    try {
      await window.hotelButler.agent.deleteConversation(target.id);
      conversations = conversations.filter((conversation) => conversation.id !== target.id);
      if (activeConversationId === target.id) resetConversationState();
      deleteTarget = null;
    } catch {
      errorMessage = '删除会话失败，请稍后重试。';
    } finally {
      deleting = false;
    }
  }

  async function confirmClearConversations(): Promise<void> {
    if (deleting || sending) return;
    deleting = true;
    errorMessage = '';
    try {
      await window.hotelButler.agent.clearConversations();
      conversations = [];
      resetConversationState();
      clearHistoryOpen = false;
    } catch {
      errorMessage = '清空历史会话失败，请稍后重试。';
    } finally {
      deleting = false;
    }
  }

  async function openConversation(conversationId: string): Promise<void> {
    if (conversationId === activeConversationId && messages.length > 0) return;
    if (!(await cancelActiveRun())) return;
    errorMessage = '';
    try {
      const conversation = await window.hotelButler.agent.getConversation(conversationId);
      activeConversationId = conversationId;
      messages = conversation.messages;
      executions = conversation.executions;
      draftContent = '';
      draftUi = null;
      preparingUi = false;
    } catch {
      errorMessage = '无法读取该会话，或它不属于当前登录用户。';
    }
  }

  async function cancelActiveRun(): Promise<boolean> {
    const runId = activeRunId;
    if (!runId) return true;
    if (stopping) return false;
    stopping = true;
    errorMessage = '';
    try {
      const result = await window.hotelButler.agent.cancelRun(runId);
      updateExecution(runId, (execution) => ({
        ...execution,
        status: result.status,
        completedAt: new Date().toISOString(),
      }));
      const conversationId = activeConversationId;
      if (conversationId) {
        const conversation = await window.hotelButler.agent.getConversation(conversationId);
        messages = conversation.messages;
        executions = conversation.executions;
      }
      draftContent = '';
      draftUi = null;
      preparingUi = false;
      activeRunId = null;
      sending = false;
      composer?.focus();
      return true;
    } catch {
      errorMessage = '停止当前执行失败，任务仍在继续，请稍后重试。';
      return false;
    } finally {
      stopping = false;
    }
  }

  async function submitPrompt(): Promise<void> {
    const content = prompt.trim();
    if (!content || sending) return;
    prompt = '';
    await startRun({ prompt: content }, content);
  }

  async function executeQuickAction(action: AgentQuickAction): Promise<void> {
    if (!action.available || sending) return;
    await startRun({ quickActionId: action.id });
  }

  async function startRun(
    request: { prompt: string } | { quickActionId: AgentQuickActionId },
    restorePrompt = '',
  ): Promise<void> {
    errorMessage = '';
    sending = true;
    draftContent = '';
    draftUi = null;
    preparingUi = false;

    try {
      let conversationId = activeConversationId;
      if (!conversationId) {
        const conversation = await window.hotelButler.agent.createConversation();
        conversations = [conversation, ...conversations];
        activeConversationId = conversation.id;
        conversationId = conversation.id;
      }
      const started = await window.hotelButler.agent.startRun({
        conversationId,
        ...request,
        clientRequestId: crypto.randomUUID(),
      });
      activeRunId = started.runId;
      messages = [...messages, started.userMessage];
      executions = [
        ...executions,
        {
          runId: started.runId,
          userMessageId: started.userMessage.id,
          assistantMessageId: null,
          status: 'running',
          steps: [],
          createdAt: new Date().toISOString(),
          completedAt: null,
        },
      ];
      for (const event of pendingRunEvents.get(started.runId) ?? []) handleRunEvent(event);
      pendingRunEvents.delete(started.runId);
      await refreshConversations();
    } catch {
      sending = false;
      if (restorePrompt) prompt = restorePrompt;
      errorMessage =
        'quickActionId' in request
          ? '快捷操作启动失败，请确认所需酒店 MCP 数据源已配置。'
          : '消息发送失败，请检查登录状态或稍后重试。';
    }
  }

  function handleStreamEnvelope(
    envelope: Parameters<Parameters<typeof window.hotelButler.agent.onStreamEvent>[0]>[0],
  ): void {
    if (envelope.kind === 'transport_error') {
      if (envelope.runId !== activeRunId) return;
      errorMessage = envelope.message;
      updateExecution(envelope.runId, (execution) => ({
        ...execution,
        status: 'failed',
        completedAt: new Date().toISOString(),
      }));
      preparingUi = false;
      sending = false;
      activeRunId = null;
      return;
    }
    handleRunEvent(envelope.event);
  }

  function handleRunEvent(event: AgentRunEvent): void {
    if (event.runId !== activeRunId) {
      if (!activeRunId && pendingRunEvents.size < 4) {
        pendingRunEvents.set(event.runId, [...(pendingRunEvents.get(event.runId) ?? []), event]);
      }
      return;
    }
    if (event.type === 'text_delta') {
      draftContent += event.delta;
      return;
    }
    if (event.type === 'tool_started') {
      if (event.toolName === 'render_hotel_ui') preparingUi = true;
      updateExecution(event.runId, (execution) => ({
        ...execution,
        steps: [
          ...execution.steps.filter((step) => step.toolCallId !== event.toolCallId),
          {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            status: 'running',
            summary: '',
          },
        ],
      }));
      return;
    }
    if (event.type === 'tool_completed') {
      updateExecution(event.runId, (execution) => ({
        ...execution,
        steps: execution.steps.some((step) => step.toolCallId === event.toolCallId)
          ? execution.steps.map((step) =>
              step.toolCallId === event.toolCallId
                ? { ...step, status: 'completed', summary: event.summary }
                : step,
            )
          : [
              ...execution.steps,
              {
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                status: 'completed',
                summary: event.summary,
              },
            ],
      }));
      return;
    }
    if (event.type === 'ui_spec') {
      draftUi = event.spec;
      preparingUi = false;
      return;
    }
    if (event.type === 'run_completed') {
      updateExecution(event.runId, (execution) => ({
        ...execution,
        assistantMessageId: event.message.id,
        status: 'completed',
        completedAt: event.createdAt,
      }));
      if (!messages.some((message) => message.id === event.message.id)) {
        messages = [...messages, event.message];
      }
      draftContent = '';
      draftUi = null;
      preparingUi = false;
      sending = false;
      activeRunId = null;
      void refreshConversations();
      return;
    }
    if (event.type === 'run_failed') {
      updateExecution(event.runId, (execution) => ({
        ...execution,
        status: 'failed',
        completedAt: event.createdAt,
      }));
      errorMessage = event.message;
      preparingUi = false;
      sending = false;
      activeRunId = null;
      return;
    }
    if (event.type === 'run_cancelled') {
      updateExecution(event.runId, (execution) => ({
        ...execution,
        status: 'cancelled',
        completedAt: event.createdAt,
      }));
      draftContent = '';
      draftUi = null;
      preparingUi = false;
      sending = false;
      activeRunId = null;
    }
  }

  function updateExecution(
    runId: string,
    update: (execution: AgentExecutionTrace) => AgentExecutionTrace,
  ): void {
    executions = executions.map((execution) =>
      execution.runId === runId ? update(execution) : execution,
    );
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
            disabled={sending || deleting}
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
            <span class="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-primary"></span>
          {/if}
          <button
            class="w-full rounded-lg py-2 pr-8 pl-2.5 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            type="button"
            aria-label={conversation.title}
            aria-pressed={conversation.id === activeConversationId}
            onclick={() => void openConversation(conversation.id)}
          >
            <span class="line-clamp-2 text-[13px] leading-5 font-medium">{conversation.title}</span>
            <span class="mt-0.5 block text-[10px] leading-4 text-muted-foreground/70">
              {formatConversationUpdatedAt(conversation.updatedAt)}
            </span>
          </button>
          <button
            class="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground opacity-0 transition-[color,background-color,opacity] hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none group-hover/history:opacity-100 group-focus-within/history:opacity-100"
            type="button"
            aria-label={`删除会话：${conversation.title}`}
            disabled={sending || deleting}
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
      <div class="group/agent flex items-center gap-3">
        <AgentAvatar online />
        <div>
          <p class="m-0 text-[10px] font-medium tracking-[0.08em] text-muted-foreground">
            小智 AI 管家
          </p>
          <h1 class="m-0 mt-0.5 max-w-xl truncate text-sm font-semibold">
            {activeConversation?.title ?? '新会话'}
          </h1>
        </div>
      </div>
      {#if sending}
        <span class="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircle class="animate-spin" size={14} />正在处理
        </span>
      {/if}
    </header>

    <section
      class="min-h-0 flex-1 overflow-y-auto bg-muted/20"
      aria-label="对话内容"
      aria-live="polite"
    >
      <div
        class="mx-auto w-full max-w-3xl px-7 py-8"
        use:autoAnimate={{ ...LAYOUT_ANIMATION_OPTIONS, duration: 260 }}
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
                    'group rounded-xl border border-border/80 bg-card px-3.5 py-3 text-left transition-[background-color,border-color,box-shadow,transform] duration-200 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transform-none',
                    action.available
                      ? 'hover:-translate-y-0.5 hover:border-input hover:shadow-md'
                      : 'cursor-not-allowed opacity-60',
                  ]}
                  type="button"
                  disabled={!action.available || sending}
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
            class:justify-end={message.role === 'user'}
            class="mt-6 flex gap-3"
            data-agent-message-id={message.id}
            data-agent-message-role={message.role}
            in:enter={{ ...SURFACE_TRANSITION_OPTIONS, duration: 240, y: 5 }}
          >
            {#if message.role === 'assistant'}<AgentAvatar size="sm" />{/if}
            <div class="min-w-0 max-w-[82%]">
              {#if message.content && message.role === 'assistant'}
                <AgentMarkdown content={message.content} />
              {:else if message.content}
                <p
                  class="m-0 whitespace-pre-wrap rounded-xl bg-secondary px-4 py-3 text-sm leading-7 transition-colors duration-200 ease-out"
                >
                  {message.content}
                </p>
              {/if}
              {#if message.ui}
                <div class="mt-3"><HotelGenerativeUi spec={message.ui} /></div>
              {/if}
              {#if execution && message.role === 'assistant'}
                <AgentExecutionTimeline trace={execution} />
              {/if}
            </div>
          </article>
          {#if execution && message.role === 'user'}
            <article
              class="mt-3 flex gap-3"
              data-agent-execution-for-message={message.id}
              in:enter={{ ...SURFACE_TRANSITION_OPTIONS, duration: 220, y: 4 }}
            >
              <AgentAvatar size="sm" />
              <div class="min-w-0 flex-1">
                <AgentExecutionTimeline trace={execution} />
              </div>
            </article>
          {/if}
        {/each}

        {#if sending || draftContent || draftUi}
          {@const execution = activeExecution()}
          <article
            class="mt-6 flex gap-3"
            in:enter={{ ...SURFACE_TRANSITION_OPTIONS, duration: 240, y: 5 }}
          >
            <AgentAvatar size="sm" />
            <div class="min-w-0 flex-1">
              {#if draftContent}
                <AgentMarkdown content={draftContent} />
              {:else if preparingUi}
                <p class="m-0 inline-flex items-center gap-2 text-sm text-muted-foreground">
                  <LoaderCircle class="animate-spin" size={15} />正在生成结果视图…
                </p>
              {:else}
                <p class="m-0 inline-flex items-center gap-2 text-sm text-muted-foreground">
                  <LoaderCircle class="animate-spin" size={15} />正在理解任务…
                </p>
              {/if}
              {#if preparingUi}
                <div
                  class="mt-3 h-36 animate-pulse rounded-xl border border-border/70 bg-muted/55 motion-reduce:animate-none"
                  aria-hidden="true"
                ></div>
              {/if}
              {#if draftUi}<div class="mt-4"><HotelGenerativeUi spec={draftUi} /></div>{/if}
              {#if execution}<AgentExecutionTimeline trace={execution} />{/if}
            </div>
          </article>
        {/if}

        {#if errorMessage}
          <div
            class="mt-6 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          >
            <TriangleAlert class="mt-0.5 shrink-0" size={16} />{errorMessage}
          </div>
        {/if}
      </div>
    </section>

    <footer class="shrink-0 border-t border-border/60 bg-background/95 px-6 pt-3 pb-4">
      <div class="mx-auto max-w-3xl">
        {#if quickActionCards.length > 0 && messages.length > 0}
          <div class="mb-2 flex gap-2 overflow-x-auto pb-1" aria-label="酒店快捷操作">
            {#each quickActionCards as action (action.id)}
              <button
                class={[
                  'inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
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
                <action.icon size={13} />
                {action.label}
                {#if !action.available}<span class="text-[10px]">需 MCP</span>{/if}
              </button>
            {/each}
          </div>
        {/if}
        <div
          class="rounded-xl border border-input bg-background p-2 shadow-md focus-within:border-primary focus-within:ring-3 focus-within:ring-ring/20"
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
          <div class="flex items-center justify-between px-1">
            <span class="text-[10px] text-muted-foreground">Enter 发送 · Shift+Enter 换行</span>
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
      <AlertDialog.Description>
        「{deleteTarget?.title}」及其消息和执行记录将永久删除，长期记忆不受影响。
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel disabled={deleting}>取消</AlertDialog.Cancel>
      <AlertDialog.Action
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        disabled={deleting}
        onclick={() => void confirmDeleteConversation()}
      >
        {#if deleting}<LoaderCircle class="animate-spin" size={14} />正在删除{:else}删除{/if}
      </AlertDialog.Action>
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
