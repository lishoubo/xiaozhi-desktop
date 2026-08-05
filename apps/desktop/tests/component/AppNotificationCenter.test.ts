import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
// ESLint's current resolver does not understand Svelte's documented package subpath export.
// eslint-disable-next-line import/no-unresolved
import { get } from 'svelte/store';
import AppNotificationCenter from '../../src/renderer/components/layout/AppNotificationCenter.svelte';
import {
  appNotifications,
  clearAppNotifications,
  showAppNotification,
} from '../../src/renderer/notifications';

beforeEach(() => {
  clearAppNotifications();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AppNotificationCenter', () => {
  it('renders application notifications with shared actions and dismissal', async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    render(AppNotificationCenter);

    showAppNotification({
      id: 'calendar-load-error',
      title: '日历读取失败',
      message: '未能读取日历数据，请重试。',
      tone: 'error',
      action: { label: '重试', run: retry },
    });

    const center = screen.getByRole('complementary', { name: '系统通知' });
    const alert = await screen.findByRole('alert');
    expect(center).toContainElement(alert);
    expect(alert).toHaveTextContent('日历读取失败');
    expect(alert).toHaveTextContent('未能读取日历数据，请重试。');

    await user.click(screen.getByRole('button', { name: '重试' }));

    expect(retry).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    showAppNotification({
      id: 'calendar-save-error',
      title: '日历保存失败',
      message: '已恢复为上次保存的内容。',
      tone: 'error',
    });
    await user.click(await screen.findByRole('button', { name: '关闭日历保存失败通知' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('puts newer notifications first and dismisses each on its own timer', async () => {
    vi.useFakeTimers();
    const { container } = render(AppNotificationCenter);

    showAppNotification({
      id: 'first',
      title: '第一条',
      message: '先出现',
      tone: 'default',
      durationMs: 2_000,
    });
    vi.advanceTimersByTime(1_000);
    showAppNotification({
      id: 'second',
      title: '第二条',
      message: '后出现',
      tone: 'default',
      durationMs: 3_000,
    });
    await tick();

    expect(
      [...container.querySelectorAll('[data-notification-id]')].map((item) =>
        item.getAttribute('data-notification-id'),
      ),
    ).toEqual(['second', 'first']);

    vi.advanceTimersByTime(1_000);
    await tick();
    expect(get(appNotifications).map((notification) => notification.id)).toEqual(['second']);

    vi.advanceTimersByTime(2_000);
    await tick();
    expect(get(appNotifications)).toEqual([]);
  });
});
