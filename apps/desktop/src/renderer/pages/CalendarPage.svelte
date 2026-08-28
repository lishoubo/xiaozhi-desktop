<script lang="ts">
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
  import { Button } from '$lib/components/ui/button';
  import { Spinner } from '$lib/components/ui/spinner';
  import { enter } from '../motion';
  import log from 'electron-log/renderer';
  import { errorFields } from '../logging';
  import { dismissAppNotification, showAppNotification } from '../notifications';
  import type { CalendarSnapshot } from '../../shared/calendar';
  import CalendarSidebarPanel from '../calendar/CalendarSidebarPanel.svelte';
  import {
    bindCalendarPersistence,
    desktopCalendarDataSource,
    toCalendarEvents,
  } from '../calendar/calendar-data-source';
  import {
    createAllDayCalendarDraft,
    isValidCalendarDateRange,
    parseCalendarCellDate,
  } from '../calendar/calendar-editor';
  import { formatCalendarRangeLabel, type CalendarView } from '../calendar/calendar-navigation';

  const words = { ...coreChinese, ...calendarChinese };
  type EditorActionEvent = {
    item: { id?: string | number };
  };
  let snapshot = $state<CalendarSnapshot | null>(null);
  let loading = $state(true);
  let api = $state<CalendarInstanceApi>();
  let currentView = $state<CalendarView>('month');
  let rangeLabel = $state('');
  let currentDate = $state(new Date());
  let visibleDateRange = $state({ start: new Date(), end: new Date() });
  let editorValues = $state<Record<string, unknown>>({});
  let isCreatingEvent = $state(false);
  let overflowDate = $state<Date | null>(null);
  let lastDateClick = '';
  let lastDateClickAt = 0;
  let suppressOutsideInteraction = false;
  let unbindPersistence: (() => void) | undefined;
  let unbindNavigation: (() => void) | undefined;
  let unbindEditorState: (() => void) | undefined;

  function eventsForDate(date: Date): ReturnType<typeof toCalendarEvents> {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return events.filter((event) => event.start < end && event.end > start);
  }

  function resetDateClickSequence(): void {
    lastDateClick = '';
    lastDateClickAt = 0;
  }

  const editorItems = [
    ...getEditorItems().map((item) => {
      if (item.key === 'start') {
        return {
          ...item,
          validation: (value: unknown) => isValidCalendarDateRange(value, editorValues.end),
          validationMessage: '开始日期必须早于结束日期',
        };
      }
      if (item.key === 'end') {
        return {
          ...item,
          validation: (value: unknown) => isValidCalendarDateRange(editorValues.start, value),
          validationMessage: '结束日期必须晚于开始日期',
        };
      }
      return item;
    }),
    {
      comp: 'textarea',
      key: 'notes',
      label: '备注',
      validation: (value: unknown) => typeof value !== 'string' || value.length <= 2000,
      validationMessage: '备注最多可填写 2000 个字符',
      config: { placeholder: '补充酒店运营相关信息' },
    },
  ];

  const editorBottomBar = $derived({
    items: [
      ...(!isCreatingEvent ? [{ comp: 'button', id: 'delete', text: '删除', type: 'danger' }] : []),
      { comp: 'spacer' },
      { comp: 'button', id: 'done', text: '完成', type: 'primary' },
    ],
  });

  const events = $derived(snapshot ? toCalendarEvents(snapshot.events) : []);
  const overflowEvents = $derived(overflowDate ? eventsForDate(overflowDate) : []);
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
    resetDateClickSequence();
    overflowDate = null;
    await api.exec('navigate-time', { direction });
    syncNavigationState(api);
  }

  async function changeView(view: CalendarView): Promise<void> {
    if (!api) return;
    resetDateClickSequence();
    overflowDate = null;
    await api.exec('navigate-to', { view });
    syncNavigationState(api);
  }

  async function addEvent(event: Record<string, unknown> = {}): Promise<void> {
    if (!api) return;
    resetDateClickSequence();
    overflowDate = null;
    await api.exec('add-event', { event, edit: true });
  }

  async function closeEditor(): Promise<void> {
    if (!api) return;
    await api.exec('select-event', { id: null });
    isCreatingEvent = false;
    editorValues = {};
    resetDateClickSequence();
  }

  function handleEditorChange(event: { update: Record<string, unknown> }): void {
    editorValues = { ...event.update };
  }

  function handleEditorAction(event: EditorActionEvent): void {
    if (!api) return;
    if (event.item.id === 'done') {
      void closeEditor();
      return;
    }
    if (event.item.id === 'delete') {
      const selected = api.getState().editorData;
      if (selected) {
        void api.exec('delete-event', { id: selected.id }).then(() => {
          editorValues = {};
        });
      }
      return;
    }
  }

  function handleDocumentMouseDown(event: MouseEvent): void {
    if (suppressOutsideInteraction) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!api?.getState().editorData) return;
    const target = event.target;
    if (target instanceof Element && target.closest('.wx-editor-calendar, .wx-popup')) return;
    suppressOutsideInteraction = true;
    resetDateClickSequence();
    event.preventDefault();
    event.stopPropagation();
    void closeEditor();
  }

  function suppressClosingInteraction(event: MouseEvent): void {
    if (!suppressOutsideInteraction) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.type === 'click') suppressOutsideInteraction = false;
  }

  function handleCalendarMouseUp(event: MouseEvent): void {
    if (event.button !== 0 || currentView !== 'month') return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const moreButton = target.closest('.wx-more-button');
    if (moreButton) {
      if (event.type !== 'click') return;
      const buttonRect = moreButton.getBoundingClientRect();
      const centerX = buttonRect.left + buttonRect.width / 2;
      const centerY = buttonRect.top + buttonRect.height / 2;
      const cells = Array.from(document.querySelectorAll<HTMLElement>('.wx-grid-cell'));
      const cellFromViewport = cells.find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return (
          centerX >= rect.left &&
          centerX <= rect.right &&
          centerY >= rect.top &&
          centerY <= rect.bottom
        );
      });
      const button = moreButton as HTMLElement;
      const cell =
        cellFromViewport ??
        cells.find(
          (candidate) =>
            button.offsetLeft >= candidate.offsetLeft &&
            button.offsetLeft < candidate.offsetLeft + candidate.offsetWidth &&
            button.offsetTop >= candidate.offsetTop &&
            button.offsetTop < candidate.offsetTop + candidate.offsetHeight,
        );
      const dateValue = cell?.querySelector<HTMLElement>('[data-date]')?.dataset.date;
      const date = dateValue ? parseCalendarCellDate(dateValue) : null;
      if (date) {
        event.preventDefault();
        event.stopPropagation();
        const nextDate = new Date(date);
        nextDate.setDate(nextDate.getDate() + 1);
        const hiddenEventCount = Number.parseInt(moreButton.textContent?.match(/\d+/)?.[0] ?? '');
        const dateEventCount = eventsForDate(date).length;
        const nextDateEventCount = eventsForDate(nextDate).length;
        const belongsToNextDate = Number.isNaN(hiddenEventCount)
          ? dateEventCount === 0 && nextDateEventCount > 0
          : dateEventCount <= hiddenEventCount && nextDateEventCount > hiddenEventCount;
        overflowDate = belongsToNextDate ? nextDate : date;
      }
      return;
    }
    if (target.closest('[data-id], .wx-calendar-sidebar')) return;
    const cell = target.closest('.wx-grid-cell');
    if (cell) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function handleCalendarMouseDown(event: MouseEvent): void {
    if (event.button !== 0 || currentView !== 'month') return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('.wx-more-button')) {
      event.stopPropagation();
      return;
    }
    if (target.closest('[data-id], .wx-calendar-sidebar')) return;
    if (target.closest('.wx-grid-cell')) event.stopPropagation();
  }

  function handleCalendarClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('.wx-more-button')) {
      handleCalendarMouseUp(event);
      return;
    }
    if (currentView !== 'month' || target.closest('[data-id], .wx-calendar-sidebar')) return;
    const cell = target.closest('.wx-grid-cell');
    const dateValue = cell?.querySelector<HTMLElement>('[data-date]')?.dataset.date;
    if (!dateValue) return;
    const date = parseCalendarCellDate(dateValue);
    if (!date) return;
    event.preventDefault();
    event.stopPropagation();
    const now = performance.now();
    if (lastDateClick === dateValue && now - lastDateClickAt <= 500) {
      resetDateClickSequence();
      void addEvent(createAllDayCalendarDraft(date));
      return;
    }
    lastDateClick = dateValue;
    lastDateClickAt = now;
  }

  function bindEditorState(calendarApi: CalendarInstanceApi): () => void {
    const tag = Symbol('calendar-editor-state');
    calendarApi.intercept(
      'add-event',
      (action) => {
        resetDateClickSequence();
        overflowDate = null;
        isCreatingEvent = true;
        if (typeof action === 'object' && action !== null && 'event' in action) {
          editorValues = { ...(action.event as Record<string, unknown>) };
        }
      },
      { tag },
    );
    calendarApi.on(
      'select-event',
      (action) => {
        resetDateClickSequence();
        const id =
          typeof action === 'object' && action !== null && 'id' in action ? action.id : null;
        if (id !== null) {
          overflowDate = null;
          isCreatingEvent = false;
        }
        const selected = calendarApi.getState().editorData;
        editorValues = selected ? { ...selected } : {};
        return true;
      },
      { tag },
    );
    return () => calendarApi.detach(tag);
  }

  async function loadCalendar(): Promise<void> {
    loading = true;
    try {
      snapshot = await desktopCalendarDataSource.load();
      dismissAppNotification('calendar-load-error');
    } catch (error) {
      log.warn('Calendar data could not be loaded', errorFields(error));
      showAppNotification({
        id: 'calendar-load-error',
        title: '日历读取失败',
        message: '未能读取日历数据，请重试。',
        tone: 'error',
        action: { label: '重试', run: loadCalendar },
      });
    } finally {
      loading = false;
    }
  }

  async function recoverCalendar(): Promise<void> {
    loading = true;
    try {
      snapshot = await desktopCalendarDataSource.load();
      showAppNotification({
        id: 'calendar-save-error',
        title: '日历保存失败',
        message: '已恢复为上次保存的内容。',
        tone: 'error',
      });
    } catch (error) {
      log.warn('Calendar data could not be re-read after a failed save', errorFields(error));
      showAppNotification({
        id: 'calendar-save-error',
        title: '日历保存失败',
        message: '未能重新读取已保存的内容。',
        tone: 'error',
        action: { label: '重试读取', run: recoverCalendar },
      });
    } finally {
      loading = false;
    }
  }

  function initializeCalendar(nextApi: CalendarInstanceApi): void {
    api = nextApi;
    unbindPersistence?.();
    unbindNavigation?.();
    unbindEditorState?.();
    unbindPersistence = bindCalendarPersistence(
      nextApi,
      desktopCalendarDataSource,
      recoverCalendar,
    );
    unbindNavigation = bindCalendarNavigation(nextApi);
    unbindEditorState = bindEditorState(nextApi);
  }

  onMount(() => {
    void loadCalendar();
    document.addEventListener('pointerdown', handleDocumentMouseDown, true);
    document.addEventListener('mousedown', handleDocumentMouseDown, true);
    document.addEventListener('mouseup', suppressClosingInteraction, true);
    document.addEventListener('click', suppressClosingInteraction, true);
  });
  onDestroy(() => {
    document.removeEventListener('pointerdown', handleDocumentMouseDown, true);
    document.removeEventListener('mousedown', handleDocumentMouseDown, true);
    document.removeEventListener('mouseup', suppressClosingInteraction, true);
    document.removeEventListener('click', suppressClosingInteraction, true);
    unbindPersistence?.();
    unbindNavigation?.();
    unbindEditorState?.();
    dismissAppNotification('calendar-load-error');
    dismissAppNotification('calendar-save-error');
  });
</script>

<section
  class="hotel-calendar h-full min-h-0 bg-background p-4"
  aria-label="酒店运营日历"
  data-motion="page"
  onpointerdowncapture={handleDocumentMouseDown}
  onmousedowncapture={handleDocumentMouseDown}
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
              <div
                class="flex h-full min-h-0"
                class:overflow-panel-open={overflowDate !== null}
                onclickcapture={handleCalendarClick}
                onmousedowncapture={handleCalendarMouseDown}
                onmouseupcapture={handleCalendarMouseUp}
              >
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
                {#if overflowDate}
                  <aside
                    class="flex w-80 shrink-0 flex-col border-l border-border bg-card"
                    aria-label={`${overflowDate.getFullYear()}年${overflowDate.getMonth() + 1}月${overflowDate.getDate()}日日程`}
                  >
                    <div class="flex items-center justify-between border-b border-border px-4 py-3">
                      <div>
                        <div class="text-sm font-semibold">
                          {overflowDate.getMonth() + 1}月{overflowDate.getDate()}日
                        </div>
                        <div class="text-xs text-muted-foreground">
                          共 {overflowEvents.length} 项日程
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="关闭当日日程"
                        onclick={() => (overflowDate = null)}>关闭</Button
                      >
                    </div>
                    <div class="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                      {#each overflowEvents as overflowEvent (overflowEvent.id)}
                        <button
                          type="button"
                          class="w-full rounded-md border border-border bg-background px-3 py-2 text-left hover:bg-muted"
                          aria-label={`编辑${overflowEvent.text}`}
                          onclick={() => {
                            overflowDate = null;
                            if (api) void api.exec('select-event', { id: overflowEvent.id });
                          }}
                        >
                          <span class="block truncate text-sm font-medium">
                            {overflowEvent.text}
                          </span>
                          <span class="block text-xs text-muted-foreground">
                            {overflowEvent.allDay
                              ? '全天'
                              : overflowEvent.start.toLocaleTimeString('zh-CN', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                          </span>
                        </button>
                      {/each}
                    </div>
                  </aside>
                {/if}
                {#if api}
                  <Editor
                    {api}
                    items={editorItems}
                    topBar={false}
                    bottomBar={editorBottomBar}
                    onchange={handleEditorChange}
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
      <Button variant="outline" onclick={() => void loadCalendar()}>重新加载日历</Button>
    </div>
  {/if}
</section>

<style>
  :global(.hotel-calendar .wx-willow-theme) {
    --wx-color-primary: #0a0a0a;
    --wx-color-primary-hover: #1c1c1e;
    --wx-font-family: inherit;
    height: 100%;
  }

  :global(.hotel-calendar .wx-calendar-sidebar) {
    width: 280px;
    min-width: 280px;
    max-width: 280px;
    overflow-x: hidden;
  }

  :global(.hotel-calendar .overflow-panel-open .wx-more-button) {
    display: none;
  }

  :global(.hotel-calendar .cal-holiday.wx-bar-event),
  :global(.hotel-calendar .cal-holiday.wx-box-event) {
    background: rgb(195 125 13 / 0.12);
    color: #793400;
    border-color: #c37d0d;
  }

  :global(.hotel-calendar .cal-personal.wx-bar-event),
  :global(.hotel-calendar .cal-personal.wx-box-event) {
    background: rgb(55 114 207 / 0.1);
    color: #285ba8;
    border-color: #3772cf;
  }

  :global(.hotel-calendar .cal-mock.wx-bar-event),
  :global(.hotel-calendar .cal-mock.wx-box-event) {
    background: rgb(0 212 164 / 0.12);
    color: #165f43;
    border-color: #00b48a;
  }

  :global(.hotel-calendar .wx-calendar-name.cal-holiday) {
    background: rgb(195 125 13 / 0.12);
    color: #793400;
  }

  :global(.hotel-calendar .wx-calendar-name.cal-personal) {
    background: rgb(55 114 207 / 0.1);
    color: #285ba8;
  }

  :global(.hotel-calendar .wx-calendar-name.cal-mock) {
    background: rgb(0 212 164 / 0.12);
    color: #165f43;
  }
</style>
