import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StartupAutomationDialog from '../../src/renderer/components/automation/StartupAutomationDialog.svelte';

const autoAnimate = vi.hoisted(() =>
  vi.fn(() => ({ enable: vi.fn(), disable: vi.fn(), isEnabled: vi.fn(() => true) })),
);

vi.mock('@formkit/auto-animate', () => ({ autoAnimate, default: autoAnimate }));

afterEach(() => {
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
    await Promise.resolve();
    await tick();

    const status = screen.getByRole('status');
    expect(autoAnimate).toHaveBeenCalledWith(expect.any(HTMLElement), {
      duration: 180,
      easing: 'ease-out',
    });
    expect(status).toHaveTextContent('获取到的今日携程入住时间为：8月1日');
    expect(status).toHaveAttribute('data-slot', 'alert');
    expect(status.querySelector('svg')).toBeInTheDocument();
    expect(status.parentElement).toHaveClass('top-4', 'right-4', 'max-w-[22rem]');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(container.querySelector('[data-slot="dialog-overlay"]')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    vi.advanceTimersByTime(5_000);
    await tick();

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
