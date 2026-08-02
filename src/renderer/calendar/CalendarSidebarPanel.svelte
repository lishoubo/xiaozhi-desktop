<script lang="ts">
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import type { CalendarInstanceApi } from '@svar-ui/svelte-calendar';
  import { Calendar as MiniCalendar, Checkbox } from '@svar-ui/svelte-core';
  import { untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';

  type CalendarGroup = Readonly<{
    id: string;
    label: string;
    css: string;
  }>;

  let {
    api,
    groups,
    currentDate,
    visibleDateRange,
  }: {
    api: CalendarInstanceApi;
    groups: CalendarGroup[];
    currentDate: Date;
    visibleDateRange: Readonly<{ start: Date; end: Date }>;
  } = $props();

  let active = $state<Record<string, boolean>>({});
  let miniCurrent = $state(new Date());

  $effect(() => {
    for (const group of groups) active[group.id] ??= true;
  });

  $effect(() => {
    const next = currentDate;
    untrack(() => {
      miniCurrent = new Date(next.getFullYear(), next.getMonth(), 1);
    });
  });

  const miniMonthLabel = $derived(`${miniCurrent.getFullYear()}年${miniCurrent.getMonth() + 1}月`);

  function markers(date: Date): string {
    const time = date.getTime();
    return time >= visibleDateRange.start.getTime() && time < visibleDateRange.end.getTime()
      ? 'wx-view-range'
      : '';
  }

  function applyFilter(): void {
    const activeIds = groups.filter((group) => active[group.id]).map((group) => group.id);
    const filter =
      activeIds.length === groups.length
        ? null
        : (event: Record<string, unknown>) =>
            typeof event.calendarId === 'string' && active[event.calendarId] === true;
    void api.exec('filter-events', { filter, tag: 'calendar-panel' });
  }

  function toggleGroup(id: string): void {
    active[id] = !active[id];
    applyFilter();
  }

  function shiftMiniMonth(offset: number): void {
    miniCurrent = new Date(miniCurrent.getFullYear(), miniCurrent.getMonth() + offset, 1);
  }

  function selectDate(value: Date | null): void {
    if (value) void api.exec('navigate-to', { date: value });
  }
</script>

<div class="wx-calendar-panel hotel-mini-calendar" data-slot="calendar-panel" style="width: 280px">
  <div role="group" aria-label="日历筛选">
    {#each groups as group (group.id)}
      <div class={`wx-calendar-name ${group.css}`}>
        <Checkbox
          value={active[group.id] ?? true}
          onchange={() => toggleGroup(group.id)}
          label={group.label}
        />
      </div>
    {/each}
  </div>

  <div class="mt-3 flex items-center justify-between px-2">
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="迷你日历上一个月"
      onclick={() => shiftMiniMonth(-1)}
    >
      <ChevronLeft />
    </Button>
    <span class="text-sm font-medium" data-testid="mini-calendar-month">{miniMonthLabel}</span>
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="迷你日历下一个月"
      onclick={() => shiftMiniMonth(1)}
    >
      <ChevronRight />
    </Button>
  </div>

  <MiniCalendar
    value={currentDate}
    current={miniCurrent}
    buttons={false}
    {markers}
    onchange={({ value }) => selectDate(value)}
  />
</div>

<style>
  .wx-calendar-panel {
    display: flex;
    width: 280px;
    flex-direction: column;
    gap: 4px;
    overflow: hidden;
    padding: var(--wx-padding);
  }

  :global(.hotel-mini-calendar > .wx-calendar > .wx-wrap > .wx-header) {
    display: none;
  }

  :global(.hotel-mini-calendar .wx-calendar-name) {
    margin-top: 4px;
    border: none !important;
    border-radius: var(--wx-border-radius);
    padding: 4px;
  }

  :global(.hotel-mini-calendar .wx-view-range:not(.wx-selected):not(.wx-out)) {
    border-radius: 0;
    background: var(--wx-color-primary-selected);
  }
</style>
