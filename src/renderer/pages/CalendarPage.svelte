<script lang="ts">
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Plus from '@lucide/svelte/icons/plus';
  import {
    Calendar,
    Editor,
    Willow,
    getEditorItems,
    type CalendarInstanceApi,
    type EventContext,
  } from '@svar-ui/svelte-calendar';
  import { cn as calendarChinese } from '@svar-ui/calendar-locales';
  import { cn as coreChinese } from '@svar-ui/core-locales';
  import { Locale } from '@svar-ui/svelte-core';
  import { onDestroy, onMount } from 'svelte';
  import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
  import { Button } from '$lib/components/ui/button';
  import { Spinner } from '$lib/components/ui/spinner';
  import { enter } from '../motion';
  import type { CalendarSnapshot } from '../../shared/calendar';
  import CalendarSidebarPanel from '../calendar/CalendarSidebarPanel.svelte';
  import {
    bindCalendarPersistence,
    desktopCalendarDataSource,
    toCalendarEvents,
  } from '../calendar/calendar-data-source';
  import { formatCalendarRangeLabel, type CalendarView } from '../calendar/calendar-navigation';

  const words = { ...coreChinese, ...calendarChinese };
  const editorItems = [
    ...getEditorItems(),
    {
      comp: 'textarea',
      key: 'notes',
      label: '备注',
      validation: (value: unknown) => typeof value !== 'string' || value.length <= 2000,
      validationMessage: '备注最多可填写 2000 个字符',
      config: { placeholder: '补充酒店运营相关信息' },
    },
  ];
  const editorBottomBar = {
    items: [
      { comp: 'spacer' },
      { comp: 'button', id: 'cancel', text: '取消' },
      { comp: 'button', id: 'save', text: '确认', type: 'primary' },
    ],
  };
  let snapshot = $state<CalendarSnapshot | null>(null);
  let errorMessage = $state('');
  let loading = $state(true);
  let api = $state<CalendarInstanceApi>();
  let currentView = $state<CalendarView>('month');
  let rangeLabel = $state('');
  let currentDate = $state(new Date());
  let visibleDateRange = $state({ start: new Date(), end: new Date() });
  let unbindPersistence: (() => void) | undefined;
  let unbindNavigation: (() => void) | undefined;

  const events = $derived(snapshot ? toCalendarEvents(snapshot.events) : []);
  function calendarCss(calendarId: string): string {
    if (calendarId === 'china-mainland-holidays') return 'cal-holiday';
    if (calendarId === 'mock-hotel-operations') return 'cal-mock';
    return 'cal-personal';
  }

  const calendarGroups = $derived(
    snapshot?.groups.map((group) => ({
      id: group.id,
      label: group.label,
      css: calendarCss(group.id),
    })) ?? [],
  );

  function eventCss({ event }: EventContext): string {
    return calendarCss(String(event.calendarId));
  }

  function isCalendarView(value: string): value is CalendarView {
    return value === 'day' || value === 'week' || value === 'month';
  }

  function syncNavigationState(calendarApi: CalendarInstanceApi): void {
    const state = calendarApi.getState();
    if (isCalendarView(state.currentView)) currentView = state.currentView;
    currentDate = new Date(state.currentDate);
    visibleDateRange = {
      start: new Date(state.visibleDateRange.start),
      end: new Date(state.visibleDateRange.end),
    };
    rangeLabel = formatCalendarRangeLabel(currentView, state.rangeLabel, visibleDateRange);
  }

  function bindCalendarNavigation(calendarApi: CalendarInstanceApi): () => void {
    const tag = Symbol('calendar-navigation');
    const scheduleSync = (): true => {
      window.setTimeout(() => syncNavigationState(calendarApi), 0);
      return true;
    };
    calendarApi.on('navigate-to', scheduleSync, { tag });
    calendarApi.on('navigate-time', scheduleSync, { tag });
    syncNavigationState(calendarApi);
    return () => calendarApi.detach(tag);
  }

  async function navigateTime(direction: 'next' | 'previous' | 'now'): Promise<void> {
    if (!api) return;
    await api.exec('navigate-time', { direction });
    syncNavigationState(api);
  }

  async function changeView(view: CalendarView): Promise<void> {
    if (!api) return;
    await api.exec('navigate-to', { view });
    syncNavigationState(api);
  }

  async function addEvent(): Promise<void> {
    if (!api) return;
    await api.exec('add-event', { event: {}, edit: true });
  }

  function handleEditorAction(event: { item: { id?: string | number } }): void {
    if (!api) return;
    if (event.item.id === 'cancel') {
      const selected = api.getState().editorData;
      if (selected && selected.source === undefined) {
        void api.exec('delete-event', { id: selected.id });
      } else {
        void api.exec('select-event', { id: null });
      }
      return;
    }
    if (event.item.id === 'save') {
      window.setTimeout(() => {
        if (api) void api.exec('select-event', { id: null });
      }, 0);
    }
  }

  async function loadCalendar(): Promise<void> {
    loading = true;
    try {
      snapshot = await desktopCalendarDataSource.load();
      errorMessage = '';
    } catch {
      errorMessage = '日历读取失败，请重试';
    } finally {
      loading = false;
    }
  }

  async function recoverCalendar(): Promise<void> {
    loading = true;
    try {
      snapshot = await desktopCalendarDataSource.load();
      errorMessage = '日历保存失败，已恢复为上次保存的内容';
    } catch {
      errorMessage = '日历保存失败，且未能重新读取已保存的内容';
    } finally {
      loading = false;
    }
  }

  function initializeCalendar(nextApi: CalendarInstanceApi): void {
    api = nextApi;
    unbindPersistence?.();
    unbindNavigation?.();
    unbindPersistence = bindCalendarPersistence(
      nextApi,
      desktopCalendarDataSource,
      recoverCalendar,
    );
    unbindNavigation = bindCalendarNavigation(nextApi);
  }

  onMount(() => {
    void loadCalendar();
  });
  onDestroy(() => {
    unbindPersistence?.();
    unbindNavigation?.();
  });
</script>

<section
  class="hotel-calendar h-full min-h-0 bg-background p-4"
  aria-label="酒店运营日历"
  data-motion="page"
  in:enter
>
  {#if loading}
    <div class="grid h-full place-items-center" role="status">
      <div class="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        <span>正在加载日历</span>
      </div>
    </div>
  {:else if snapshot}
    <div class="flex h-full min-h-0 flex-col gap-3">
      {#if errorMessage}
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>日历未能保存</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      {/if}

      <div
        class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card"
      >
        <header
          class="grid min-h-14 shrink-0 grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-border px-3"
        >
          <div class="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={!api}
              onclick={() => void navigateTime('now')}>今天</Button
            >
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="上一个时段"
              disabled={!api}
              onclick={() => void navigateTime('previous')}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="下一个时段"
              disabled={!api}
              onclick={() => void navigateTime('next')}
            >
              <ChevronRight />
            </Button>
          </div>

          <h2 class="truncate text-center text-sm font-semibold" aria-live="polite">
            {rangeLabel}
          </h2>

          <div class="flex items-center gap-2">
            <div
              class="flex rounded-md border border-border p-0.5"
              role="group"
              aria-label="日历视图"
            >
              {#each [['day', '日'], ['week', '周'], ['month', '月']] as [view, label]}
                <Button
                  variant={currentView === view ? 'secondary' : 'ghost'}
                  size="sm"
                  class="h-7 min-w-9 px-2"
                  aria-label={`${label}视图`}
                  aria-pressed={currentView === view}
                  disabled={!api}
                  onclick={() => void changeView(view as CalendarView)}>{label}</Button
                >
              {/each}
            </div>
            <Button size="sm" disabled={!api} onclick={() => void addEvent()}>
              <Plus />
              新建日程
            </Button>
          </div>
        </header>

        <div class="min-h-0 flex-1">
          <Locale {words}>
            <Willow fonts={false}>
              <div class="flex h-full min-h-0">
                <div class="min-w-0 flex-1">
                  <Calendar
                    {events}
                    date={new Date()}
                    view="month"
                    toolbar={null}
                    init={initializeCalendar}
                    {eventCss}
                  >
                    {#if api}
                      <CalendarSidebarPanel
                        {api}
                        groups={calendarGroups}
                        {currentDate}
                        {visibleDateRange}
                      />
                    {/if}
                  </Calendar>
                </div>
                {#if api}
                  <Editor
                    {api}
                    items={editorItems}
                    topBar={false}
                    bottomBar={editorBottomBar}
                    autoSave={false}
                    onaction={handleEditorAction}
                  />
                {/if}
              </div>
            </Willow>
          </Locale>
        </div>
      </div>
    </div>
  {:else}
    <div class="grid h-full place-items-center">
      <Alert variant="destructive" class="max-w-md">
        <CircleAlert />
        <AlertTitle>日历读取失败</AlertTitle>
        <AlertDescription class="flex items-center justify-between gap-4">
          <span>{errorMessage}</span>
          <Button variant="outline" size="sm" onclick={() => void loadCalendar()}>重试</Button>
        </AlertDescription>
      </Alert>
    </div>
  {/if}
</section>

<style>
  :global(.hotel-calendar .wx-willow-theme) {
    --wx-color-primary: #5645d4;
    --wx-color-primary-hover: #4534b3;
    --wx-font-family: inherit;
    height: 100%;
  }

  :global(.hotel-calendar .wx-calendar-sidebar) {
    width: 280px;
    min-width: 280px;
    max-width: 280px;
    overflow-x: hidden;
  }

  :global(.hotel-calendar .cal-holiday.wx-bar-event),
  :global(.hotel-calendar .cal-holiday.wx-box-event) {
    background: #ffe8d4;
    color: #793400;
    border-color: #dd5b00;
  }

  :global(.hotel-calendar .cal-personal.wx-bar-event),
  :global(.hotel-calendar .cal-personal.wx-box-event) {
    background: #e6e0f5;
    color: #3a2a99;
    border-color: #5645d4;
  }

  :global(.hotel-calendar .cal-mock.wx-bar-event),
  :global(.hotel-calendar .cal-mock.wx-box-event) {
    background: #d9f3e1;
    color: #165f43;
    border-color: #2a9d99;
  }

  :global(.hotel-calendar .wx-calendar-name.cal-holiday) {
    background: #ffe8d4;
    color: #793400;
  }

  :global(.hotel-calendar .wx-calendar-name.cal-personal) {
    background: #e6e0f5;
    color: #3a2a99;
  }

  :global(.hotel-calendar .wx-calendar-name.cal-mock) {
    background: #d9f3e1;
    color: #165f43;
  }
</style>
