import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/renderer/App.svelte';

const createTab = vi.fn().mockResolvedValue({
  id: 'tab-1',
  channelId: 'ctrip',
  title: '携程酒店 eBooking',
  url: 'https://ebooking.ctrip.com/',
  canGoBack: false,
  canGoForward: false,
  loading: false,
});

describe('App routing and query integration', () => {
  beforeEach(() => {
    window.location.hash = '';
    localStorage.clear();
    localStorage.setItem(
      'hotel-butler.auth-session',
      JSON.stringify({ phone: '13800138000', expiresAt: Date.now() + 60_000 }),
    );
    localStorage.setItem('hotel-butler.cookie-import-prompted', 'true');
    createTab.mockClear();

    Object.defineProperty(window, 'hotelButler', {
      configurable: true,
      value: {
        versions: {
          chrome: '1',
          electron: '2',
          node: '3',
        },
        settings: {
          list: vi.fn().mockResolvedValue([]),
          get: vi.fn(),
          set: vi.fn(),
          delete: vi.fn(),
        },
        browser: {
          create: createTab,
          activate: vi.fn(),
          close: vi.fn(),
          goBack: vi.fn(),
          goForward: vi.fn(),
          hide: vi.fn(),
          list: vi.fn().mockResolvedValue([]),
          reload: vi.fn(),
          setBounds: vi.fn(),
          onStateChanged: vi.fn(() => vi.fn()),
        },
        cookies: {
          import: vi.fn(),
        },
        system: {
          getPreferences: vi.fn().mockResolvedValue({ autoLaunch: false, version: '1.0.0' }),
          setAutoLaunch: vi.fn(),
        },
      },
    });
  });

  it('navigates from the OTA workspace to settings', async () => {
    const user = userEvent.setup();
    render(App);

    expect(await screen.findByRole('button', { name: '携程酒店 eBooking' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByRole('textbox', { name: '网址' })).not.toBeInTheDocument();
    expect(createTab).toHaveBeenCalledWith('ctrip', 'https://ebooking.ctrip.com/');

    await user.click(screen.getByRole('link', { name: '设置' }));

    expect(await screen.findByRole('heading', { name: '设置' })).toBeInTheDocument();
    expect(await screen.findByText('V1.0')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/settings');
  });

  it('returns to login after the user signs out', async () => {
    const user = userEvent.setup();
    render(App);

    await user.click(screen.getByRole('link', { name: /用户中心/ }));
    await user.click(await screen.findByRole('button', { name: '退出登录' }));

    expect(await screen.findByRole('heading', { name: '登录' })).toBeInTheDocument();
    expect(localStorage.getItem('hotel-butler.auth-session')).toBeNull();
  });
});
