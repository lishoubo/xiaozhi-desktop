import { render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProfilePage from '../../src/renderer/pages/ProfilePage.svelte';
import SettingsPage from '../../src/renderer/pages/SettingsPage.svelte';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(
    'hotel-butler.auth-session',
    JSON.stringify({ phone: '13800138000', expiresAt: Date.now() + 60_000 }),
  );
  Object.defineProperty(window, 'hotelButler', {
    configurable: true,
    value: {
      system: {
        getPreferences: vi.fn().mockResolvedValue({ autoLaunch: false, version: '1.0.0' }),
        setAutoLaunch: vi.fn(),
      },
      cookies: {
        listSources: vi.fn().mockResolvedValue([]),
        import: vi.fn(),
      },
    },
  });
});

describe('product UX restraint', () => {
  it('does not present unavailable account management or repeat the full phone number', () => {
    render(ProfilePage);

    expect(screen.getByText('138****8000')).toBeInTheDocument();
    expect(screen.queryByText('13800138000')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '修改' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '注销' })).not.toBeInTheDocument();
    expect(screen.queryByText(/后端/)).not.toBeInTheDocument();
  });

  it('does not expose a desktop notification setting without notification behavior', async () => {
    render(SettingsPage);

    expect(screen.queryByText('桌面通知')).not.toBeInTheDocument();
    expect(await screen.findByText('V1.0')).toBeInTheDocument();
    expect(screen.getByText('小智酒店管家桌面客户端')).toBeInTheDocument();
  });

  it('shows settings failures with the shared icon Alert treatment', async () => {
    Object.defineProperty(window.hotelButler.system, 'getPreferences', {
      configurable: true,
      value: vi.fn().mockRejectedValue(new Error('settings unavailable')),
    });

    render(SettingsPage);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('设置读取失败，请重试');
    expect(alert).toHaveAttribute('data-slot', 'alert');
    expect(alert.querySelector('svg')).toBeInTheDocument();
  });
});
