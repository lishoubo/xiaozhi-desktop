import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import StartupAutomationDialog from '../../src/renderer/components/automation/StartupAutomationDialog.svelte';

describe('startup automation result', () => {
  it('shows the Ctrip check-in text in a dialog', async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, 'hotelButler', {
      configurable: true,
      value: {
        automation: {
          getCtripCheckIn: vi.fn().mockResolvedValue({ ok: true, checkIn: '8月1日' }),
        },
      },
    });

    render(StartupAutomationDialog);

    expect(await screen.findByText('获取到的今日携程入住时间为：8月1日')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '知道了' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
