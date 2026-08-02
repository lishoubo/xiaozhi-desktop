import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CalendarPage from '../../src/renderer/pages/CalendarPage.svelte';

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
      startsAt: '2026-08-02T09:00:00.000',
      endsAt: '2026-08-02T10:00:00.000',
      allDay: false,
      notes: '核对各 OTA 库存',
      source: 'user' as const,
    },
  ],
};

const load = vi.fn();
const createEvent = vi.fn();
const updateEvent = vi.fn();

beforeEach(() => {
  load.mockReset();
  load.mockResolvedValue(snapshot);
  createEvent.mockReset();
  createEvent.mockResolvedValue(undefined);
  updateEvent.mockReset();
  updateEvent.mockResolvedValue(undefined);
  Object.defineProperty(window, 'hotelButler', {
    configurable: true,
    value: {
      calendar: {
        load,
        createEvent,
        updateEvent,
        deleteEvent: vi.fn(),
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

  it('offers a retry when the local calendar cannot be read', async () => {
    const user = userEvent.setup();
    load.mockRejectedValueOnce(new Error('database unavailable')).mockResolvedValueOnce(snapshot);
    render(CalendarPage);

    expect(await screen.findByRole('alert')).toHaveTextContent('日历读取失败，请重试');
    await user.click(screen.getByRole('button', { name: '重试' }));

    expect(await screen.findByText('中国大陆节假日')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('discards a newly added event when editing is cancelled', async () => {
    const user = userEvent.setup();
    render(CalendarPage);

    await user.click(await screen.findByRole('button', { name: '新建日程' }));

    expect(await screen.findByRole('textbox', { name: '备注' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '关闭' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '取消' }));

    expect(createEvent).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: '备注' })).not.toBeInTheDocument();
  });

  it('creates on confirmation and keeps existing events unchanged when editing is cancelled', async () => {
    const user = userEvent.setup();
    render(CalendarPage);

    await user.click(await screen.findByRole('button', { name: '新建日程' }));
    const title = await screen.findByRole('textbox', { name: '文本' });
    const notes = screen.getByRole('textbox', { name: '备注' });

    await user.clear(title);
    await user.type(title, '临时新建日程');
    await user.type(notes, '跟进渠道库存');
    expect(updateEvent).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '确认' }));

    expect(createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ title: '临时新建日程', notes: '跟进渠道库存' }),
    );
    expect(screen.queryByRole('textbox', { name: '备注' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '日视图' }));
    await user.click(await screen.findByText('渠道库存与房态核对'));
    const existingTitle = await screen.findByRole('textbox', { name: '文本' });
    await user.clear(existingTitle);
    await user.type(existingTitle, '不应保存的标题');
    await user.click(screen.getByRole('button', { name: '取消' }));

    expect(updateEvent).not.toHaveBeenCalled();
    expect(await screen.findByText('渠道库存与房态核对')).toBeInTheDocument();

    await user.click(screen.getByText('渠道库存与房态核对'));
    const confirmedTitle = await screen.findByRole('textbox', { name: '文本' });
    await user.clear(confirmedTitle);
    await user.type(confirmedTitle, '渠道库存复核完成');
    await user.click(screen.getByRole('button', { name: '确认' }));
    expect(updateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'existing-hotel-operation',
        event: expect.objectContaining({ title: '渠道库存复核完成' }),
      }),
    );
  });
});
