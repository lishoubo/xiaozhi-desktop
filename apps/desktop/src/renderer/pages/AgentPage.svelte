<script lang="ts">
  import { autoAnimate } from '@formkit/auto-animate';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import Check from '@lucide/svelte/icons/check';
  import ClipboardList from '@lucide/svelte/icons/clipboard-list';
  import Copy from '@lucide/svelte/icons/copy';
  import Database from '@lucide/svelte/icons/database';
  import FileText from '@lucide/svelte/icons/file-text';
  import Paperclip from '@lucide/svelte/icons/paperclip';
  import Plus from '@lucide/svelte/icons/plus';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import ThumbsDown from '@lucide/svelte/icons/thumbs-down';
  import ThumbsUp from '@lucide/svelte/icons/thumbs-up';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import {
    enter,
    LAYOUT_ANIMATION_OPTIONS,
    PAGE_ENTER_OPTIONS,
    SURFACE_TRANSITION_OPTIONS,
  } from '../motion';
  import AgentAvatar from '../components/agent/AgentAvatar.svelte';
  import HotelGenerativeUi from '../components/agent/HotelGenerativeUi.svelte';
  import {
    findHotelPreview,
    hotelGenerativeUiPreviews,
    type HotelPreview,
  } from '../generative-ui/mock-specs';
  import { Button } from '$lib/components/ui/button';
  import { Separator } from '$lib/components/ui/separator';
  import { Textarea } from '$lib/components/ui/textarea';
  import * as Tooltip from '$lib/components/ui/tooltip';

  type LocalMessage = {
    id: number;
    role: 'user' | 'assistant';
    content: string;
  };

  const suggestions = [
    {
      label: '检查异常订单',
      description: '找出临近超时和信息缺失的订单',
      prompt: '检查今天的异常订单',
      icon: TriangleAlert,
      tone: 'bg-[#ffe8d4] text-[#793400]',
    },
    {
      label: '生成运营简报',
      description: '汇总入住、房态、点评和待办',
      prompt: '生成今日酒店运营简报',
      icon: FileText,
      tone: 'bg-[#dcecfa] text-[#005bab]',
    },
    {
      label: '安排今日待办',
      description: '按紧急程度整理今天的工作',
      prompt: '帮我整理今天的待办事项',
      icon: ClipboardList,
      tone: 'bg-[#d9f3e1] text-[#176c2b]',
    },
  ];

  let prompt = $state('');
  let localMessages = $state<LocalMessage[]>([]);
  let nextMessageId = 1;
  let showSample = $state(false);
  let attachmentName = $state('');
  let copied = $state(false);
  let activePreview = $state<HotelPreview | null>(null);
  let fileInput: HTMLInputElement;
  let composer = $state<HTMLTextAreaElement | null>(null);

  function startNewConversation(): void {
    prompt = '';
    localMessages = [];
    attachmentName = '';
    showSample = false;
    activePreview = null;
  }

  function selectSuggestion(value: string): void {
    prompt = value;
    composer?.focus();
  }

  function openSampleConversation(): void {
    prompt = '';
    localMessages = [];
    attachmentName = '';
    showSample = true;
    activePreview = null;
  }

  function openGenerativeUiPreview(preview: HotelPreview): void {
    prompt = '';
    localMessages = [];
    attachmentName = '';
    showSample = false;
    activePreview = findHotelPreview(preview.id);
  }

  function submitPrompt(): void {
    const content = prompt.trim();
    if (!content) return;

    showSample = false;
    activePreview = null;
    localMessages = [
      ...localMessages,
      { id: nextMessageId++, role: 'user', content },
      {
        id: nextMessageId++,
        role: 'assistant',
        content: '收到。我会先梳理任务所需信息，并把处理进度和结果及时告诉你。',
      },
    ];
    prompt = '';
    attachmentName = '';
  }

  function handleComposerKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submitPrompt();
    }
  }

  function handleFile(event: Event): void {
    attachmentName = (event.currentTarget as HTMLInputElement).files?.[0]?.name ?? '';
  }

  async function copySample(): Promise<void> {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText('今日入住 42 间，待确认订单 2 笔，需回复点评 3 条。');
    }
    copied = true;
  }
</script>

<div
  class="grid h-full min-h-0 grid-cols-[200px_minmax(0,1fr)] bg-background"
  data-motion="page"
  in:enter={PAGE_ENTER_OPTIONS}
>
  <aside class="flex min-h-0 flex-col border-r border-border bg-background px-3 py-4">
    <Button class="w-full justify-start" variant="outline" onclick={startNewConversation}>
      <Plus size={16} />
      新对话
    </Button>

    <div class="mt-6 min-h-0 flex-1 overflow-y-auto">
      <p class="px-2 text-xs font-medium text-muted-foreground">今天</p>
      <button
        class={[
          'mt-1 w-full rounded-md px-3 py-2.5 text-left text-sm transition-colors duration-150 ease-out motion-reduce:transition-none',
          showSample
            ? 'bg-accent font-medium text-accent-foreground'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        ]}
        type="button"
        aria-pressed={showSample}
        onclick={openSampleConversation}
      >
        今日运营摘要
      </button>
      <button
        class="mt-1 w-full rounded-md px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors duration-150 ease-out hover:bg-muted hover:text-foreground motion-reduce:transition-none"
        type="button"
        onclick={startNewConversation}
      >
        订单异常排查
      </button>
    </div>
  </aside>

  <main class="flex min-h-0 min-w-0 flex-col">
    <header class="flex h-[68px] shrink-0 items-center justify-between border-b border-border px-6">
      <div class="group/agent flex items-center gap-3">
        <AgentAvatar />
        <div>
          <h1 class="m-0 text-sm font-semibold">小智AI 管家</h1>
          <p class="m-0 mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span class="size-1.5 rounded-full bg-[#1aae39]"></span>
            随时可以帮你
          </p>
        </div>
      </div>
      {#if showSample}
        <span
          class="rounded-md bg-secondary px-2 py-1 text-xs font-medium text-muted-foreground"
          in:enter={SURFACE_TRANSITION_OPTIONS}>示例会话</span
        >
      {:else if activePreview}
        <span
          class="rounded-md bg-secondary px-2 py-1 text-xs font-medium text-muted-foreground"
          in:enter={SURFACE_TRANSITION_OPTIONS}>静态预览</span
        >
      {/if}
    </header>

    <section
      class="min-h-0 flex-1 overflow-y-auto bg-[#fafaf9]"
      aria-label="对话内容"
      aria-live="polite"
    >
      <div class="mx-auto w-full max-w-3xl px-7 py-8">
        {#if activePreview}
          <article class="flex gap-3" in:enter={SURFACE_TRANSITION_OPTIONS}>
            <AgentAvatar size="sm" />
            <div class="min-w-0 flex-1">
              <p class="m-0 mb-3 text-xs font-medium text-muted-foreground">小智 · 生成式 UI</p>
              <HotelGenerativeUi spec={activePreview.spec} />
            </div>
          </article>
        {:else if showSample}
          <article class="flex justify-end" in:enter={SURFACE_TRANSITION_OPTIONS}>
            <p class="m-0 max-w-[75%] rounded-lg bg-secondary px-4 py-3 text-sm leading-6">
              帮我总结今天的酒店运营情况，标出需要优先处理的事项。
            </p>
          </article>

          <article class="mt-7 flex gap-3" in:enter={{ ...SURFACE_TRANSITION_OPTIONS, delay: 40 }}>
            <AgentAvatar size="sm" />
            <div class="min-w-0 flex-1">
              <p class="m-0 text-sm font-semibold">今日运营摘要</p>
              <p class="mt-3 mb-0 text-sm leading-7 text-foreground">
                今日预计入住 <strong>42 间</strong>，当前入住率 78%。有 2 笔订单需要确认，3
                条新点评待回复。
              </p>

              <div class="mt-4 overflow-hidden rounded-lg border border-border bg-card">
                <div class="flex items-center justify-between bg-secondary/70 px-4 py-3">
                  <div class="flex items-center gap-2 text-sm font-medium">
                    <ClipboardList size={16} class="text-muted-foreground" />
                    优先待办
                  </div>
                  <span class="text-xs text-muted-foreground">2 项</span>
                </div>
                <div class="divide-y divide-border">
                  <div class="flex items-start gap-3 px-4 py-3">
                    <span class="mt-1.5 size-2 shrink-0 rounded-full bg-[#dd5b00]"></span>
                    <div class="min-w-0 flex-1">
                      <p class="m-0 text-sm font-medium">确认 2 笔即将超时的订单</p>
                      <p class="mt-1 mb-0 text-xs text-muted-foreground">
                        最近一笔将在 28 分钟后超时
                      </p>
                    </div>
                    <Button size="sm" variant="outline">查看</Button>
                  </div>
                  <div class="flex items-start gap-3 px-4 py-3">
                    <span class="mt-1.5 size-2 shrink-0 rounded-full bg-primary"></span>
                    <div class="min-w-0 flex-1">
                      <p class="m-0 text-sm font-medium">回复 1 条低分点评</p>
                      <p class="mt-1 mb-0 text-xs text-muted-foreground">
                        客人反馈入住办理等待较久
                      </p>
                    </div>
                    <Button size="sm" variant="outline">起草</Button>
                  </div>
                </div>
              </div>

              <details class="mt-4 rounded-lg border border-border bg-secondary/40 px-4 py-3" open>
                <summary class="cursor-pointer text-sm font-medium">执行过程</summary>
                <div class="mt-3 grid gap-2.5">
                  <div class="flex items-center gap-2.5 text-xs text-muted-foreground">
                    <Check size={14} class="text-[#1aae39]" />
                    <span>读取各渠道今日订单</span>
                    <span class="ml-auto">1.2s</span>
                  </div>
                  <div class="flex items-center gap-2.5 text-xs text-muted-foreground">
                    <Check size={14} class="text-[#1aae39]" />
                    <span>汇总房态与待办事项</span>
                    <span class="ml-auto">0.8s</span>
                  </div>
                </div>
              </details>

              <div class="mt-4">
                <p class="m-0 text-xs font-medium text-muted-foreground">参考来源</p>
                <div class="mt-2 flex flex-wrap gap-2">
                  <button
                    class="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs transition-colors duration-150 ease-out hover:bg-secondary motion-reduce:transition-none"
                    type="button"
                  >
                    <Database size={14} />
                    渠道订单·今日
                  </button>
                  <button
                    class="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs transition-colors duration-150 ease-out hover:bg-secondary motion-reduce:transition-none"
                    type="button"
                  >
                    <FileText size={14} />
                    待办记录·7 月 31 日
                  </button>
                </div>
              </div>

              <Separator class="my-4" />
              <Tooltip.Provider delayDuration={200}>
                <div class="flex items-center gap-1">
                  <Tooltip.Root>
                    <Tooltip.Trigger>
                      {#snippet child({ props })}
                        <Button
                          {...props}
                          size="icon-sm"
                          variant="ghost"
                          aria-label="复制回复"
                          onclick={() => void copySample()}
                        >
                          {#if copied}<Check />{:else}<Copy />{/if}
                        </Button>
                      {/snippet}
                    </Tooltip.Trigger>
                    <Tooltip.Content>{copied ? '已复制' : '复制回复'}</Tooltip.Content>
                  </Tooltip.Root>
                  <Tooltip.Root>
                    <Tooltip.Trigger>
                      {#snippet child({ props })}
                        <Button {...props} size="icon-sm" variant="ghost" aria-label="重新生成">
                          <RotateCcw />
                        </Button>
                      {/snippet}
                    </Tooltip.Trigger>
                    <Tooltip.Content>重新生成</Tooltip.Content>
                  </Tooltip.Root>
                  <Button size="icon-sm" variant="ghost" aria-label="回复有帮助"
                    ><ThumbsUp /></Button
                  >
                  <Button size="icon-sm" variant="ghost" aria-label="回复无帮助"
                    ><ThumbsDown /></Button
                  >
                </div>
              </Tooltip.Provider>
            </div>
          </article>
        {:else if localMessages.length === 0}
          <div
            class="mx-auto flex max-w-2xl flex-col items-center pt-[clamp(48px,9vh,88px)] text-center"
            in:enter={SURFACE_TRANSITION_OPTIONS}
          >
            <div class="group/agent">
              <AgentAvatar size="lg" online motion="float" />
            </div>
            <p class="mt-5 mb-0 text-sm font-medium text-accent-foreground">你好，我是小智</p>
            <h2 class="mt-2 mb-0 text-2xl font-semibold tracking-[-0.02em]">今天想先处理什么？</h2>
            <div class="mt-7 grid w-full grid-cols-3 gap-3">
              {#each suggestions as suggestion}
                <button
                  class="group rounded-xl border border-border bg-card p-4 text-left transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out hover:-translate-y-0.5 hover:border-input hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transform-none motion-reduce:transition-none"
                  type="button"
                  aria-label={suggestion.label}
                  onclick={() => selectSuggestion(suggestion.prompt)}
                >
                  <span class={['mb-4 grid size-9 place-items-center rounded-lg', suggestion.tone]}>
                    <suggestion.icon size={17} />
                  </span>
                  <span class="block text-sm font-medium">{suggestion.label}</span>
                  <span class="mt-1.5 block text-xs leading-5 text-muted-foreground">
                    {suggestion.description}
                  </span>
                </button>
              {/each}
            </div>

            <div class="mt-7 w-full border-t border-border pt-5 text-left">
              <p class="m-0 text-xs font-medium text-muted-foreground">生成式 UI 快捷预览</p>
              <div class="mt-3 grid grid-cols-5 gap-2">
                {#each hotelGenerativeUiPreviews as preview (preview.id)}
                  <Button
                    class="h-auto min-h-9 justify-start px-3 py-2 text-xs"
                    variant="outline"
                    aria-label={`预览${preview.label}`}
                    title={preview.description}
                    onclick={() => openGenerativeUiPreview(preview)}
                  >
                    {preview.label}
                  </Button>
                {/each}
              </div>
            </div>
          </div>
        {/if}

        <div data-motion-layout="messages" use:autoAnimate={LAYOUT_ANIMATION_OPTIONS}>
          {#each localMessages as message (message.id)}
            <article class:justify-end={message.role === 'user'} class="mt-6 flex gap-3">
              {#if message.role === 'assistant'}
                <AgentAvatar size="sm" />
              {/if}
              <div class="max-w-[78%]">
                {#if message.role === 'assistant'}
                  <p class="m-0 mb-1 text-xs font-medium text-muted-foreground">小智</p>
                {/if}
                <p
                  class="m-0 rounded-lg text-sm leading-6"
                  class:bg-secondary={message.role === 'user'}
                  class:px-4={message.role === 'user'}
                  class:py-3={message.role === 'user'}
                >
                  {message.content}
                </p>
              </div>
            </article>
          {/each}
        </div>
      </div>
    </section>

    <footer class="shrink-0 bg-background px-6 pt-2 pb-5">
      <div class="mx-auto max-w-3xl">
        <div
          class="rounded-xl border border-input bg-background p-2 shadow-md transition-[border-color,box-shadow] duration-150 ease-out focus-within:border-primary focus-within:ring-3 focus-within:ring-ring/20 motion-reduce:transition-none"
        >
          <div class="mx-1" use:autoAnimate={LAYOUT_ANIMATION_OPTIONS}>
            {#if attachmentName}
              <div
                class="mb-1 inline-flex items-center gap-2 rounded-md bg-secondary px-2.5 py-1.5 text-xs"
              >
                <FileText size={14} />
                {attachmentName}
              </div>
            {/if}
          </div>
          <Textarea
            class="min-h-14 resize-none border-0 px-2 py-2.5 shadow-none focus-visible:ring-0"
            bind:ref={composer}
            bind:value={prompt}
            aria-label="给小智AI 管家发消息"
            placeholder="告诉小智你想完成什么…"
            onkeydown={handleComposerKeydown}
          />
          <div class="flex items-center justify-between px-1">
            <input
              class="sr-only"
              bind:this={fileInput}
              type="file"
              aria-label="选择附件"
              onchange={handleFile}
            />
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="添加附件"
              onclick={() => fileInput.click()}
            >
              <Paperclip />
            </Button>
            <Button
              size="icon-sm"
              aria-label="发送消息"
              disabled={!prompt.trim()}
              onclick={submitPrompt}
            >
              <ArrowUp />
            </Button>
          </div>
        </div>
        <p class="mt-2 mb-0 text-center text-[11px] text-muted-foreground">
          示例内容不代表实时酒店数据
        </p>
      </div>
    </footer>
  </main>
</div>
