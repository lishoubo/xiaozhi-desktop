<script lang="ts">
  import type { AgentPendingClarification } from '@hotel-butler/api';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import { Button } from '$lib/components/ui/button';

  let {
    clarification,
    submitting = false,
    onsubmit,
    oncancel,
  }: {
    clarification: AgentPendingClarification;
    submitting?: boolean;
    onsubmit: (
      answers: Readonly<Record<string, string | number | { start: string; end: string }>>,
    ) => void;
    oncancel: () => void;
  } = $props();

  let values = $state<Record<string, string>>({});
  const expired = $derived(Date.parse(clarification.expiresAt) <= Date.now());

  function answerKey(slot: string, part?: 'start' | 'end'): string {
    return part ? `${slot}.${part}` : slot;
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    const answers: Record<string, string | number | { start: string; end: string }> = {};
    for (const field of clarification.fields) {
      if (field.kind === 'date_range') {
        answers[field.slot] = {
          start: values[answerKey(field.slot, 'start')] ?? '',
          end: values[answerKey(field.slot, 'end')] ?? '',
        };
      } else if (field.kind === 'number') {
        answers[field.slot] = Number(values[field.slot]);
      } else {
        answers[field.slot] = values[field.slot] ?? '';
      }
    }
    onsubmit(answers);
  }
</script>

<form
  class="mt-3 rounded-xl border border-primary/25 bg-card p-4 shadow-sm"
  aria-label="补充任务信息"
  onsubmit={submit}
>
  <p class="m-0 text-sm font-medium text-foreground">{clarification.prompt}</p>
  {#if expired}
    <p class="mt-2 mb-0 text-xs text-destructive">这次补充信息已过期，请取消任务后重新发起。</p>
  {/if}
  <div class="mt-4 grid gap-3">
    {#each clarification.fields as field (field.slot)}
      <label class="grid gap-1.5 text-xs font-medium text-muted-foreground">
        <span>{field.label}</span>
        {#if field.kind === 'single_choice'}
          <select
            class="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
            required={field.required}
            disabled={submitting || expired}
            bind:value={values[field.slot]}
          >
            <option value="">请选择</option>
            {#each field.choices as choice (choice.value)}
              <option value={choice.value}>{choice.label}</option>
            {/each}
          </select>
        {:else if field.kind === 'date_range'}
          <span class="grid grid-cols-2 gap-2">
            <input
              class="h-10 min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground"
              type="date"
              aria-label={`${field.label}开始日期`}
              required={field.required}
              min={field.min}
              max={field.max}
              disabled={submitting || expired}
              bind:value={values[answerKey(field.slot, 'start')]}
            />
            <input
              class="h-10 min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground"
              type="date"
              aria-label={`${field.label}结束日期`}
              required={field.required}
              min={field.min}
              max={field.max}
              disabled={submitting || expired}
              bind:value={values[answerKey(field.slot, 'end')]}
            />
          </span>
        {:else}
          <input
            class="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
            type={field.kind === 'number' ? 'number' : field.kind === 'date' ? 'date' : 'text'}
            required={field.required}
            min={field.kind === 'number' || field.kind === 'date' ? field.min : undefined}
            max={field.kind === 'number' || field.kind === 'date' ? field.max : undefined}
            step={field.kind === 'number' && field.integer ? 1 : undefined}
            maxlength={field.kind === 'text' ? field.maxLength : undefined}
            disabled={submitting || expired}
            bind:value={values[field.slot]}
          />
        {/if}
      </label>
    {/each}
  </div>
  <div class="mt-4 flex justify-end gap-2">
    <Button type="button" variant="ghost" disabled={submitting} onclick={oncancel}>取消任务</Button>
    <Button type="submit" disabled={submitting || expired}>
      {#if submitting}<LoaderCircle class="animate-spin" />{/if}
      继续执行
    </Button>
  </div>
</form>
