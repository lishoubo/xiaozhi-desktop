import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
// ESLint's current resolver does not understand Svelte's documented package subpath export.
// eslint-disable-next-line import/no-unresolved
import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CalendarPage from '../../src/renderer/pages/CalendarPage.svelte';
import { appNotifications, clearAppNotifications } from '../../src/renderer/notifications';

const snapshot = {
  groups: [
    {
      id: 'china-mainland-holidays',
      label: '中国大陆节假日',
      color: '#dd5b00',
      isSystem: true,
    },
    { id: 'personal', label: '我的日历', color: '#5645d4', isSystem: true },
  ],
  events: [
    {
      id: 'cn-holiday-2026-national-day',
      calendarId: 'china-mainland-holidays',
      title: '国庆节',
      startsAt: '2026-10-01T00:00:00.000',
      endsAt: '2026-10-08T00:00:00.000',
      allDay: true,
      notes: '',
      source: 'holiday-seed' as const,
    },
    {
      id: 'existing-hotel-operation',
      calendarId: 'personal',
      title: '渠道库存与房态核对',
      startsAt: `${localDate(new Date())}T09:00:00.000`,
      endsAt: `${localDate(new Date())}T10:00:00.000`,
      allDay: false,
      notes: '核对各 OTA 库存',
      source: 'user' as const,
    },
  ],
};

function localDate(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

const load = vi.fn();
const createEvent = vi.fn();
const updateEvent = vi.fn();
const deleteEvent = vi.fn();

beforeEach(() => {
  clearAppNotifications();
  load.mockReset();
  load.mockResolvedValue(snapshot);
  createEvent.mockReset();
  createEvent.mockResolvedValue(undefined);
  updateEvent.mockReset();
  updateEvent.mockResolvedValue(undefined);
  deleteEvent.mockReset();
  deleteEvent.mockResolvedValue(undefined);
  Object.defineProperty(window, 'hotelButler', {
    configurable: true,
    value: {
      calendar: {
        load,
        createEvent,
        updateEvent,
        deleteEvent,
      },
    },
  });
});

describe('CalendarPage', () => {
  it('renders the localized SVAR calendar with the default calendar groups', async () => {
    const user = userEvent.setup();
    const { container } = render(CalendarPage);

    expect(screen.getByRole('region', { name: '酒店运营日历' })).toHaveAttribute(
      'data-motion',
      'page',
    );
    expect(await screen.findByText('中国大陆节假日')).toBeInTheDocument();
    expect(screen.getByText('我的日历')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '今天' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '上一个时段' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一个时段' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '月视图' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: '周视图' }));
    expect(screen.getByRole('button', { name: '周视图' })).toHaveAttribute('aria-pressed', 'true');

    expect(container.querySelector('[data-slot="calendar-panel"]')).toHaveStyle({
      width: '280px',
    });
    expect(container.querySelector('.wx-calendar-name.cal-holiday')).toBeInTheDocument();
    expect(container.querySelector('.wx-calendar-name.cal-personal')).toBeInTheDocument();
  });

  it('keeps read failures out of the calendar surface and offers a recovery action', async () => {
    const user = userEvent.setup();
    load.mockRejectedValueOnce(new Error('database unavailable')).mockResolvedValueOnce(snapshot);
    render(CalendarPage);

    const retry = await screen.findByRole('button', { name: '重新加载日历' });
    expect(get(appNotifications)).toEqual([
      expect.objectContaining({
        id: 'calendar-load-error',
        title: '日历读取失败',
        message: '未能读取日历数据，请重试。',
      }),
    ]);
    expect(screen.getByRole('region', { name: '酒店运营日历' })).not.toContainElement(
      screen.queryByRole('alert'),
    );
    await user.click(retry);

    expect(await screen.findByText('中国大陆节假日')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
    expect(get(appNotifications)).toHaveLength(0);
  });

  it('reports save recovery through the application notification channel', async () => {
    const user = userEvent.setup();
    createEvent.mockRejectedValueOnce(new Error('database unavailable'));
    render(CalendarPage);

    await user.click(await screen.findByRole('button', { name: '新建日程' }));

    await waitFor(() => {
      expect(get(appNotifications)).toEqual([
        expect.objectContaining({
          id: 'calendar-save-error',
          title: '日历保存失败',
          message: '已恢复为上次保存的内容。',
        }),
      ]);
    });
    expect(screen.getByRole('region', { name: '酒店运营日历' })).not.toContainElement(
      screen.queryByRole('alert'),
    );
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('creates a new event immediately and closes without rolling it back', async () => {
    const user = userEvent.setup();
    render(CalendarPage);

    await user.click(await screen.findByRole('button', { name: '新建日程' }));

    expect(await screen.findByRole('textbox', { name: '备注' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '完成' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '取消' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '关闭' })).not.toBeInTheDocument();

    await waitFor(() => expect(createEvent).toHaveBeenCalledOnce());
    await user.click(screen.getByRole('button', { name: '完成' }));

    expect(deleteEvent).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: '备注' })).not.toBeInTheDocument();
  });

  it('closes the editor from an outside click without rolling back the created event', async () => {
    const user = userEvent.setup();
    render(CalendarPage);

    await user.click(await screen.findByRole('button', { name: '新建日程' }));
    expect(await screen.findByRole('textbox', { name: '备注' })).toBeInTheDocument();

    await fireEvent.mouseDown(screen.getByRole('heading', { level: 2 }));

    expect(screen.queryByRole('textbox', { name: '备注' })).not.toBeInTheDocument();
    expect(createEvent).toHaveBeenCalledOnce();
    expect(deleteEvent).not.toHaveBeenCalled();
  });

  it('creates an all-day event immediately after the same date cell is clicked twice', async () => {
    const user = userEvent.setup();
    const { container } = render(CalendarPage);
    await screen.findByText('中国大陆节假日');

    const dateCell = container.querySelector('[data-date="2026-08-15"]')?.closest('.wx-grid-cell');
    expect(dateCell).not.toBeNull();
    await user.click(dateCell as HTMLElement);
    expect(screen.queryByRole('textbox', { name: '备注' })).not.toBeInTheDocument();
    await user.click(dateCell as HTMLElement);

    expect(await screen.findByRole('textbox', { name: '备注' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '全天' })).toBeChecked();
    expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument();
    const dateInputs = container.querySelectorAll<HTMLInputElement>(
      '.wx-event-calendar-input_wrapper input',
    );
    expect(Array.from(dateInputs, (input) => input.value)).toEqual(['2026-08-15', '2026-08-16']);
    await waitFor(() =>
      expect(createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          startsAt: '2026-08-15T00:00:00.000',
          endsAt: '2026-08-16T00:00:00.000',
          allDay: true,
        }),
      ),
    );
  });

  it('reveals time controls without changing calendar-group filters when all-day is toggled', async () => {
    const user = userEvent.setup();
    const { container } = render(CalendarPage);
    await screen.findByText('中国大陆节假日');

    const dateCell = container.querySelector('[data-date="2026-08-15"]')?.closest('.wx-grid-cell');
    expect(dateCell).not.toBeNull();
    await user.click(dateCell as HTMLElement);
    await user.click(dateCell as HTMLElement);

    const allDay = await screen.findByRole('checkbox', { name: '全天' });
    const holidayGroup = screen.getByRole('checkbox', { name: '中国大陆节假日' });
    const personalGroup = screen.getByRole('checkbox', { name: '我的日历' });
    const timePickers = Array.from(container.querySelectorAll<HTMLElement>('.wx-timepicker'));
    const editor = container.querySelector('.wx-editor-calendar');
    expect(timePickers).toHaveLength(2);
    expect(editor).toHaveClass('wx-editor-all-day');
    expect(new Set([allDay.id, holidayGroup.id, personalGroup.id]).size).toBe(3);

    await user.click(allDay);

    expect(allDay).not.toBeChecked();
    await waitFor(() => expect(editor).not.toHaveClass('wx-editor-all-day'));
    expect(holidayGroup).toBeChecked();
    expect(personalGroup).toBeChecked();

    await user.click(allDay);
    await user.click(allDay);

    expect(allDay).not.toBeChecked();
    await waitFor(() => expect(editor).not.toHaveClass('wx-editor-all-day'));
    expect(holidayGroup).toBeChecked();
    expect(personalGroup).toBeChecked();

    const startTime = timePickers[0].querySelector<HTMLInputElement>('input[readonly]');
    expect(startTime).not.toBeNull();
    await user.click(startTime as HTMLInputElement);
    const timeDigits = Array.from(
      document.querySelectorAll<HTMLInputElement>('.wx-timer .wx-digit'),
    );
    expect(timeDigits).toHaveLength(2);
    await user.clear(timeDigits[0]);
    await user.type(timeDigits[0], '14');
    await fireEvent.blur(timeDigits[0]);
    await user.clear(timeDigits[1]);
    await user.type(timeDigits[1], '30');
    await fireEvent.blur(timeDigits[1]);

    await waitFor(() =>
      expect(updateEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: expect.objectContaining({
            allDay: false,
            startsAt: '2026-08-15T14:30:00.000',
          }),
        }),
      ),
    );
  });

  it('does not count the outside click that cancels an editor as a date double-click', async () => {
    const user = userEvent.setup();
    const { container } = render(CalendarPage);
    await screen.findByText('中国大陆节假日');
    const dateCell = container.querySelector('[data-date="2026-08-15"]')?.closest('.wx-grid-cell');
    expect(dateCell).not.toBeNull();

    await user.click(screen.getByRole('button', { name: '新建日程' }));
    expect(await screen.findByRole('textbox', { name: '备注' })).toBeInTheDocument();

    await user.click(dateCell as HTMLElement);
    expect(screen.queryByRole('textbox', { name: '备注' })).not.toBeInTheDocument();
    await user.click(dateCell as HTMLElement);
    expect(screen.queryByRole('textbox', { name: '备注' })).not.toBeInTheDocument();
    await user.click(dateCell as HTMLElement);

    expect(await screen.findByRole('textbox', { name: '备注' })).toBeInTheDocument();
    expect(createEvent).toHaveBeenCalledTimes(2);
  });

  it('auto-saves new and existing event changes without a confirmation step', async () => {
    const user = userEvent.setup();
    render(CalendarPage);

    await user.click(await screen.findByRole('button', { name: '新建日程' }));
    const title = await screen.findByRole('textbox', { name: '文本' });
    const notes = screen.getByRole('textbox', { name: '备注' });

    await user.clear(title);
    await user.type(title, '自动保存日程');
    await user.type(notes, '跟进渠道库存');
    await waitFor(() =>
      expect(updateEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: expect.objectContaining({
            title: '自动保存日程',
            notes: '跟进渠道库存',
          }),
        }),
      ),
    );
    expect(createEvent).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: '完成' }));
    expect(screen.queryByRole('textbox', { name: '备注' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '日视图' }));
    await user.click(await screen.findByText('渠道库存与房态核对'));
    const existingTitle = await screen.findByRole('textbox', { name: '文本' });
    await user.clear(existingTitle);
    await user.type(existingTitle, '渠道库存复核完成');
    await waitFor(() =>
      expect(updateEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'existing-hotel-operation',
          event: expect.objectContaining({ title: '渠道库存复核完成' }),
        }),
      ),
    );
    await user.click(screen.getByRole('button', { name: '完成' }));
  });

  it('allows an existing event to be deleted from the editor', async () => {
    const user = userEvent.setup();
    render(CalendarPage);

    await user.click(await screen.findByRole('button', { name: '日视图' }));
    await user.click(await screen.findByText('渠道库存与房态核对'));
    await user.click(screen.getByRole('button', { name: '删除' }));

    expect(deleteEvent).toHaveBeenCalledWith('existing-hotel-operation');
    expect(screen.queryByRole('textbox', { name: '备注' })).not.toBeInTheDocument();
  });

  it('keeps the editor open and explains an invalid date range', async () => {
    const user = userEvent.setup();
    const { container } = render(CalendarPage);

    await user.click(await screen.findByRole('button', { name: '日视图' }));
    await user.click(await screen.findByText('渠道库存与房态核对'));
    const dateInputs = container.querySelectorAll<HTMLInputElement>(
      '.wx-event-calendar-input_wrapper input',
    );
    expect(dateInputs).toHaveLength(2);

    await user.click(dateInputs[1]);
    const previousDay = new Date();
    previousDay.setHours(0, 0, 0, 0);
    previousDay.setDate(previousDay.getDate() - 1);
    const invalidEnd = Array.from(
      document.querySelectorAll<HTMLElement>(`.wx-day[data-id="${previousDay.getTime()}"]`),
    ).find((day) => !day.closest('[data-slot="calendar-panel"]'));
    expect(invalidEnd).not.toBeNull();
    await user.click(invalidEnd as HTMLElement);

    expect(await screen.findByText('结束日期必须晚于开始日期')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '备注' })).toBeInTheDocument();
    expect(updateEvent).not.toHaveBeenCalled();
  });
});
