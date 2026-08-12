<script lang="ts">
  import type {
    AgentCapabilities,
    AgentConversationSummary,
    AgentMessage,
    AgentQuickAction,
    AgentQuickActionId,
    AgentRunEvent,
    GenerativeUiSpec,
  } from '@hotel-butler/api';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import Bot from '@lucide/svelte/icons/bot';
  import Check from '@lucide/svelte/icons/check';
  import CloudSun from '@lucide/svelte/icons/cloud-sun';
  import Hotel from '@lucide/svelte/icons/hotel';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import Plus from '@lucide/svelte/icons/plus';
  import Square from '@lucide/svelte/icons/square';
  import Sun from '@lucide/svelte/icons/sun';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import Wind from '@lucide/svelte/icons/wind';
  import Wrench from '@lucide/svelte/icons/wrench';
  import { onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import AgentAvatar from '../components/agent/AgentAvatar.svelte';
  import HotelGenerativeUi from '../components/agent/HotelGenerativeUi.svelte';
  import { PAGE_ENTER_OPTIONS, enter } from '../motion';
  import { Button } from '$lib/components/ui/button';
  import { Textarea } from '$lib/components/ui/textarea';

  type ToolStep = {
    id: string;
    name: string;
    status: 'running' | 'completed';
    summary: string;
  };

  const quickActionPresentation: Record<AgentQuickActionId, { icon: typeof Sun; tone: string }> = {
    today_weather: { icon: Sun, tone: 'bg-[#fef7d6] text-[#793400]' },
    weather_outlook: { icon: CloudSun, tone: 'bg-[#dcecfa] text-[#005bab]' },
    air_quality: { icon: Wind, tone: 'bg-[#d9f3e1] text-[#176c2b]' },
    public_hotel_rates: { icon: Hotel, tone: 'bg-[#e6e0f5] text-[#3a2a99]' },
  };

  let prompt = $state('');
  let conversations = $state.raw<AgentConversationSummary[]>([]);
  let quickActions = $state.raw<AgentQuickAction[]>([]);
  let activeConversationId = $state<string | null>(null);
  let messages = $state.raw<AgentMessage[]>([]);
  let capabilities = $state<AgentCapabilities | null>(null);
  let activeRunId = $state<string | null>(null);
  let draftContent = $state('');
  let draftUi = $state.raw<GenerativeUiSpec | null>(null);
  let toolSteps = $state.raw<ToolStep[]>([]);
  let loading = $state(true);
  let sending = $state(false);
  let errorMessage = $state('');
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
      const [nextCapabilities, nextQuickActions, nextConversations] = await Promise.all([
        window.hotelButler.agent.capabilities(),
        window.hotelButler.agent.quickActions(),
        window.hotelButler.agent.listConversations(),
      ]);
      capabilities = nextCapabilities;
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

  function startNewConversation(): void {
    cancelActiveRun();
    errorMessage = '';
    activeConversationId = null;
    messages = [];
    draftContent = '';
    draftUi = null;
    toolSteps = [];
    composer?.focus();
  }

  async function openConversation(conversationId: string): Promise<void> {
    if (conversationId === activeConversationId && messages.length > 0) return;
    cancelActiveRun();
    errorMessage = '';
    try {
      const conversation = await window.hotelButler.agent.getConversation(conversationId);
      activeConversationId = conversationId;
      messages = conversation.messages;
      draftContent = '';
      draftUi = null;
      toolSteps = [];
    } catch {
      errorMessage = '无法读取该会话，或它不属于当前登录用户。';
    }
  }

  function cancelActiveRun(): void {
    if (activeRunId) void window.hotelButler.agent.cancelRun(activeRunId);
    activeRunId = null;
    sending = false;
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
    toolSteps = [];

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
      toolSteps = [
        ...toolSteps.filter((step) => step.id !== event.toolCallId),
        { id: event.toolCallId, name: event.toolName, status: 'running', summary: '' },
      ];
      return;
    }
    if (event.type === 'tool_completed') {
      toolSteps = toolSteps.map((step) =>
        step.id === event.toolCallId
          ? { ...step, status: 'completed', summary: event.summary }
          : step,
      );
      return;
    }
    if (event.type === 'ui_spec') {
      draftUi = event.spec;
      return;
    }
    if (event.type === 'run_completed') {
      if (!messages.some((message) => message.id === event.message.id)) {
        messages = [...messages, event.message];
      }
      draftContent = '';
      draftUi = null;
      sending = false;
      activeRunId = null;
      void refreshConversations();
      return;
    }
    if (event.type === 'run_failed') {
      errorMessage = event.message;
      sending = false;
      activeRunId = null;
    }
  }

  function handleComposerKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submitPrompt();
    }
  }
</script>

<div
  class="grid h-full min-h-0 grid-cols-[220px_minmax(0,1fr)] bg-background"
  data-motion="page"
  in:enter={PAGE_ENTER_OPTIONS}
>
  <aside class="flex min-h-0 flex-col border-r border-border bg-background px-3 py-4">
    <Button
      class="w-full justify-start"
      variant={activeConversationId === null ? 'default' : 'outline'}
      aria-pressed={activeConversationId === null}
      onclick={startNewConversation}
    >
      <Plus size={16} />
      开始新会话
    </Button>

    <div class="mt-6 min-h-0 flex-1 overflow-y-auto">
      <p class="px-2 text-xs font-medium text-muted-foreground">继续历史会话</p>
      {#if conversations.length === 0 && !loading}
        <p class="px-2 py-3 text-xs leading-5 text-muted-foreground">暂无历史会话</p>
      {/if}
      {#each conversations as conversation (conversation.id)}
        <button
          class={[
            'mt-1 w-full rounded-md px-3 py-2.5 text-left text-sm transition-colors duration-150 ease-out',
            conversation.id === activeConversationId
              ? 'bg-accent font-medium text-accent-foreground'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          ]}
          type="button"
          aria-pressed={conversation.id === activeConversationId}
          onclick={() => void openConversation(conversation.id)}
        >
          <span class="line-clamp-2">{conversation.title}</span>
        </button>
      {/each}
    </div>

    {#if capabilities}
      <div
        class="rounded-lg border border-border bg-secondary/40 p-3 text-[11px] leading-5 text-muted-foreground"
      >
        <p class="m-0 font-medium text-foreground">{capabilities.model}</p>
        <p class="m-0">
          快捷操作 {capabilities.quickActionCount} · MCP {capabilities.mcpServerCount} · Skill
          {capabilities.skillCount}
        </p>
        <p class="m-0">会话持久化 · 长期记忆</p>
      </div>
    {/if}
  </aside>

  <main class="flex min-h-0 min-w-0 flex-col">
    <header class="flex h-[68px] shrink-0 items-center justify-between border-b border-border px-6">
      <div class="group/agent flex items-center gap-3">
        <AgentAvatar online />
        <div>
          <h1 class="m-0 text-sm font-semibold">小智 AI 管家</h1>
          <p class="m-0 mt-0.5 text-xs text-muted-foreground">
            {activeConversation?.title ?? '酒店运营 Agent'}
          </p>
        </div>
      </div>
      {#if sending}
        <span class="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircle class="animate-spin" size={14} />正在处理
        </span>
      {/if}
    </header>

    <section
      class="min-h-0 flex-1 overflow-y-auto bg-[#fafaf9]"
      aria-label="对话内容"
      aria-live="polite"
    >
      <div class="mx-auto w-full max-w-3xl px-7 py-8">
        {#if loading}
          <div class="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
            <LoaderCircle class="animate-spin" size={18} />正在读取会话
          </div>
        {:else if messages.length === 0 && !sending}
          <div
            class="mx-auto flex max-w-2xl flex-col items-center pt-[clamp(40px,8vh,80px)] text-center"
          >
            <AgentAvatar size="lg" online motion="float" />
            <p class="mt-5 mb-0 text-sm font-medium text-accent-foreground">你好，我是小智</p>
            <h2 class="mt-2 mb-0 text-2xl font-semibold tracking-[-0.02em]">今天想先处理什么？</h2>
            <div class="mt-7 grid w-full grid-cols-2 gap-3 lg:grid-cols-3">
              {#each quickActionCards.slice(0, 6) as action (action.id)}
                <button
                  class={[
                    'group rounded-xl border border-border bg-card p-4 text-left transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transform-none',
                    action.available
                      ? 'hover:-translate-y-0.5 hover:border-input hover:shadow-md'
                      : 'cursor-not-allowed opacity-60',
                  ]}
                  type="button"
                  disabled={!action.available || sending}
                  onclick={() => void executeQuickAction(action)}
                >
                  <span class={['mb-4 grid size-9 place-items-center rounded-lg', action.tone]}>
                    <action.icon size={17} />
                  </span>
                  <span class="block text-sm font-medium">{action.label}</span>
                  <span class="mt-1.5 block text-xs leading-5 text-muted-foreground"
                    >{action.description}</span
                  >
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
          <article class:justify-end={message.role === 'user'} class="mt-6 flex gap-3">
            {#if message.role === 'assistant'}<AgentAvatar size="sm" />{/if}
            <div class="min-w-0 max-w-[82%]">
              {#if message.role === 'assistant'}<p
                  class="m-0 mb-1 text-xs font-medium text-muted-foreground"
                >
                  小智
                </p>{/if}
              {#if message.content}
                <p
                  class:bg-secondary={message.role === 'user'}
                  class="m-0 whitespace-pre-wrap rounded-lg px-4 py-3 text-sm leading-7"
                >
                  {message.content}
                </p>
              {/if}
              {#if message.ui}
                <div class="mt-3"><HotelGenerativeUi spec={message.ui} /></div>
              {/if}
            </div>
          </article>
        {/each}

        {#if sending || draftContent || draftUi}
          <article class="mt-6 flex gap-3">
            <AgentAvatar size="sm" />
            <div class="min-w-0 flex-1">
              <p class="m-0 mb-1 text-xs font-medium text-muted-foreground">小智</p>
              {#if draftContent}
                <p class="m-0 whitespace-pre-wrap text-sm leading-7">{draftContent}</p>
              {:else}
                <p class="m-0 inline-flex items-center gap-2 text-sm text-muted-foreground">
                  <LoaderCircle class="animate-spin" size={15} />正在理解任务…
                </p>
              {/if}
              {#if draftUi}<div class="mt-4"><HotelGenerativeUi spec={draftUi} /></div>{/if}
              {#if toolSteps.length > 0}
                <details
                  class="mt-4 rounded-lg border border-border bg-secondary/40 px-4 py-3"
                  open
                >
                  <summary class="cursor-pointer text-sm font-medium">执行过程</summary>
                  <div class="mt-3 grid gap-2.5">
                    {#each toolSteps as step (step.id)}
                      <div class="flex items-start gap-2.5 text-xs text-muted-foreground">
                        {#if step.status === 'completed'}
                          <Check size={14} class="mt-0.5 shrink-0 text-[#1aae39]" />
                        {:else}
                          <Wrench size={14} class="mt-0.5 shrink-0 text-primary" />
                        {/if}
                        <span
                          ><strong class="font-medium text-foreground">{step.name}</strong
                          >{step.summary ? ` · ${step.summary}` : ''}</span
                        >
                      </div>
                    {/each}
                  </div>
                </details>
              {/if}
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

    <footer class="shrink-0 bg-background px-6 pt-2 pb-5">
      <div class="mx-auto max-w-3xl">
        {#if quickActionCards.length > 0}
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
            placeholder="检查异常订单、生成运营简报，或告诉小智你的工作偏好…"
            disabled={sending}
            onkeydown={handleComposerKeydown}
          />
          <div class="flex items-center justify-between px-1">
            <span class="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Bot size={13} />单 Agent · 会话隔离
            </span>
            {#if sending}
              <Button
                size="icon-sm"
                variant="outline"
                aria-label="停止接收"
                onclick={cancelActiveRun}><Square /></Button
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
        <p class="mt-2 mb-0 text-center text-[11px] text-muted-foreground">
          重要操作执行前请核对酒店、日期、渠道与影响范围
        </p>
      </div>
    </footer>
  </main>
</div>
