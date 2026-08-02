import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AppNotificationCenter from '../../src/renderer/components/layout/AppNotificationCenter.svelte';
import { clearAppNotifications, showAppNotification } from '../../src/renderer/notifications';

beforeEach(() => {
  clearAppNotifications();
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
});
