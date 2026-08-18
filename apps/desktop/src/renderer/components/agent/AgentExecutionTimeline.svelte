<script lang="ts">
  import type { AgentExecutionTrace } from '@hotel-butler/api';
  import { autoAnimate } from '@formkit/auto-animate';
  import Check from '@lucide/svelte/icons/check';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import CircleDashed from '@lucide/svelte/icons/circle-dashed';
  import Square from '@lucide/svelte/icons/square';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import Wrench from '@lucide/svelte/icons/wrench';
  import { onMount } from 'svelte';
  import { enter, LAYOUT_ANIMATION_OPTIONS, SURFACE_TRANSITION_OPTIONS } from '../../motion';

  let { trace }: { trace: AgentExecutionTrace } = $props();
  let expanded = $state(false);

  onMount(() => {
    expanded = trace.status === 'running';
  });

  const statusText = $derived(
    trace.status === 'running'
      ? '执行中'
      : trace.status === 'completed'
        ? '已完成'
        : trace.status === 'cancelled'
          ? '已停止'
          : '未完成',
  );

  function stepLabel(
    toolName: string,
    stepStatus: AgentExecutionTrace['steps'][number]['status'],
    traceStatus: AgentExecutionTrace['status'],
  ): string {
    if (toolName !== 'upstream_llm_analysis') return toolName;
    if (stepStatus === 'completed') return '上游大模型分析';
    return traceStatus === 'failed' ? '上游大模型分析超时或失败' : '上游大模型正在分析经营数据';
  }
</script>

<div
  class="mt-3 overflow-hidden rounded-xl border border-border/70 bg-background/75 shadow-[0_8px_24px_-20px_rgba(15,23,42,0.45)]"
  data-agent-execution-id={trace.runId}
  data-agent-execution-status={trace.status}
  in:enter={{ ...SURFACE_TRANSITION_OPTIONS, y: 4 }}
>
  <button
    class="flex w-full items-center gap-2 px-3.5 py-2.5 text-left transition-colors duration-200 ease-out hover:bg-muted/55 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    type="button"
    aria-expanded={expanded}
    onclick={() => (expanded = !expanded)}
  >
    <CircleDashed
      size={14}
      class={[
        'shrink-0 text-muted-foreground',
        trace.status === 'running' && 'animate-spin motion-reduce:animate-none',
      ]}
    />
    <span class="min-w-0 flex-1 text-xs font-medium text-foreground">本次对话的执行流程</span>
    <span class="text-[10px] text-muted-foreground">{statusText}</span>
    <ChevronDown
      size={14}
      class={[
        'shrink-0 text-muted-foreground transition-transform duration-200 ease-out motion-reduce:transition-none',
        expanded && 'rotate-180',
      ]}
    />
  </button>

  {#if expanded}
    <div
      class="border-t border-border/60 px-3.5 py-3"
      use:autoAnimate={LAYOUT_ANIMATION_OPTIONS}
      in:enter={{ duration: 180, y: 3 }}
    >
      <div class="flex items-start gap-2.5 text-xs text-muted-foreground">
        <Check size={14} class="mt-0.5 shrink-0 text-emerald-600" />
        <span>已接收任务并开始分析</span>
      </div>

      {#each trace.steps as step (step.toolCallId)}
        <div class="relative mt-2.5 flex items-start gap-2.5 text-xs text-muted-foreground">
          <span class="absolute top-[-11px] left-[6px] h-3 border-l border-border"></span>
          {#if step.status === 'completed'}
            <Check size={14} class="mt-0.5 shrink-0 text-emerald-600" />
          {:else if trace.status === 'failed' && step.toolName === 'upstream_llm_analysis'}
            <TriangleAlert size={14} class="mt-0.5 shrink-0 text-amber-600" />
          {:else if trace.status === 'cancelled'}
            <Square size={14} class="mt-0.5 shrink-0 text-muted-foreground" />
          {:else}
            <Wrench size={14} class="mt-0.5 shrink-0 text-primary" />
          {/if}
          <span class="min-w-0 leading-5">
            <strong class="break-all font-medium text-foreground"
              >{stepLabel(step.toolName, step.status, trace.status)}</strong
            >
            {#if step.summary}<span> · {step.summary}</span>{/if}
          </span>
        </div>
      {/each}

      {#if trace.status !== 'running'}
        <div class="relative mt-2.5 flex items-start gap-2.5 text-xs text-muted-foreground">
          <span class="absolute top-[-11px] left-[6px] h-3 border-l border-border"></span>
          {#if trace.status === 'completed'}
            <Check size={14} class="mt-0.5 shrink-0 text-emerald-600" />
            <span>已整理并返回完整结果</span>
          {:else if trace.status === 'cancelled'}
            <Square size={14} class="mt-0.5 shrink-0 text-muted-foreground" />
            <span>已由你停止，可继续输入新的要求</span>
          {:else}
            <TriangleAlert size={14} class="mt-0.5 shrink-0 text-amber-600" />
            <span>本次执行未能完整结束</span>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>
