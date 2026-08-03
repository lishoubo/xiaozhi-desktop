import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StartupAutomationDialog from '../../src/renderer/components/automation/StartupAutomationDialog.svelte';
import AppNotificationCenter from '../../src/renderer/components/layout/AppNotificationCenter.svelte';
import { clearAppNotifications } from '../../src/renderer/notifications';

const autoAnimate = vi.hoisted(() =>
  vi.fn(() => ({ enable: vi.fn(), disable: vi.fn(), isEnabled: vi.fn(() => true) })),
);

vi.mock('@formkit/auto-animate', () => ({ autoAnimate, default: autoAnimate }));

afterEach(() => {
  clearAppNotifications();
  vi.useRealTimers();
  autoAnimate.mockClear();
});

describe('startup automation result', () => {
  it('shows the Ctrip check-in text without blocking the browser workspace', async () => {
    vi.useFakeTimers();
    Object.defineProperty(window, 'hotelButler', {
      configurable: true,
      value: {
        automation: {
          getCtripCheckIn: vi.fn().mockResolvedValue({ ok: true, checkIn: '8月1日' }),
        },
      },
    });

    const { container } = render(StartupAutomationDialog);
    render(AppNotificationCenter);
    await Promise.resolve();
    await tick();

    const status = screen.getByRole('alert');
    expect(autoAnimate).toHaveBeenCalledWith(expect.any(HTMLElement), {
      duration: 180,
      easing: 'ease-out',
    });
    expect(status).toHaveTextContent('获取到的今日携程入住时间为：8月1日');
    expect(status).toHaveAttribute('data-slot', 'alert');
    expect(status.querySelector('svg')).toBeInTheDocument();
    expect(status.closest('aside')).toHaveClass('top-4', 'right-4');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(container.querySelector('[data-slot="dialog-overlay"]')).not.toBeInTheDocument();

    vi.advanceTimersByTime(5_000);
    await tick();

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
