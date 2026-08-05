import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/renderer/App.svelte';
import { clearAppNotifications } from '../../src/renderer/notifications';

const createTab = vi.fn().mockResolvedValue({
  id: 'tab-1',
  channelId: 'ctrip',
  title: '携程酒店 eBooking',
  url: 'https://ebooking.ctrip.com/',
  canGoBack: false,
  canGoForward: false,
  loading: false,
});
const listCookieSources = vi.fn();
const importCookies = vi.fn();

describe('App routing and query integration', () => {
  beforeEach(() => {
    window.location.hash = '';
    clearAppNotifications();
    localStorage.clear();
    localStorage.setItem(
      'hotel-butler.auth-session',
      JSON.stringify({ phone: '13800138000', expiresAt: Date.now() + 60_000 }),
    );
    localStorage.setItem('hotel-butler.cookie-import-prompted', 'true');
    createTab.mockClear();
    listCookieSources.mockReset();
    importCookies.mockReset();
    listCookieSources.mockResolvedValue([{ id: 'firefox', name: 'Mozilla Firefox' }]);
    importCookies.mockResolvedValue({ imported: 8, failed: 0 });

    Object.defineProperty(window, 'hotelButler', {
      configurable: true,
      value: {
        automation: {
          getCtripCheckIn: vi.fn().mockResolvedValue(null),
        },
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
          acknowledgeInterception: vi.fn(),
          activate: vi.fn(),
          close: vi.fn(),
          goBack: vi.fn(),
          goForward: vi.fn(),
          hide: vi.fn(),
          list: vi.fn().mockResolvedValue([]),
          reload: vi.fn(),
          setBounds: vi.fn(),
          onStateChanged: vi.fn(() => vi.fn()),
          onRequestIntercepted: vi.fn(() => vi.fn()),
        },
        cookies: {
          listSources: listCookieSources,
          import: importCookies,
        },
        otaAccount: {
          startLogin: createTab,
          listByChannel: vi.fn().mockResolvedValue([]),
          openExisting: vi.fn(),
          onAccountBound: vi.fn(() => vi.fn()),
        },
        calendar: {
          load: vi.fn().mockResolvedValue({
            groups: [
              {
                id: 'china-mainland-holidays',
                label: '中国大陆节假日',
                color: '#dd5b00',
                isSystem: true,
              },
              { id: 'personal', label: '我的日历', color: '#5645d4', isSystem: true },
            ],
            events: [],
          }),
          createEvent: vi.fn(),
          updateEvent: vi.fn(),
          deleteEvent: vi.fn(),
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
    expect(createTab).not.toHaveBeenCalled();

    await user.click(screen.getByRole('link', { name: '设置' }));

    const settingsHeading = await screen.findByRole('heading', { name: '设置' });
    expect(settingsHeading.closest('[data-motion="page"]')).toBeInTheDocument();
    expect(await screen.findByText('V1.0')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/settings');
  });

  it('uses icon-only navigation and opens the AI concierge workspace', async () => {
    const user = userEvent.setup();
    render(App);

    const navigation = screen.getByRole('navigation', { name: '应用导航' });
    const agentLink = screen.getByRole('link', { name: '小智AI 管家' });
    expect(navigation).not.toHaveTextContent('浏览器');
    expect(navigation).not.toHaveTextContent('用户中心');
    expect(navigation).not.toHaveTextContent('设置');
    expect(agentLink.querySelector('[data-agent-avatar]')).toBeInTheDocument();
    expect(agentLink.querySelector('[data-agent-status="breathing"]')).toBeInTheDocument();

    await user.click(agentLink);

    const agentHeading = await screen.findByRole('heading', { name: '小智AI 管家' });
    expect(agentHeading.closest('[data-motion="page"]')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '给小智AI 管家发消息' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/agent');
  });

  it('opens the calendar workspace from the application sidebar', async () => {
    const user = userEvent.setup();
    render(App);

    await user.click(screen.getByRole('link', { name: '日历' }));

    await waitFor(() => expect(window.location.hash).toBe('#/calendar'));

    const calendar = await screen.findByRole('region', { name: '酒店运营日历' });
    expect(calendar.closest('[data-motion="page"]')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/calendar');
  });

  it('opens the managed hotel list from the application sidebar', async () => {
    const user = userEvent.setup();
    render(App);

    await user.click(screen.getByRole('link', { name: '酒店管理' }));

    await waitFor(() => expect(window.location.hash).toBe('#/hotels'));
    expect(await screen.findByRole('heading', { name: '酒店管理' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '上海云栖酒店' })).toBeInTheDocument();
  });

  it('collapses and expands the wider icon sidebar without tooltip wrappers', async () => {
    const user = userEvent.setup();
    render(App);

    const toggle = screen.getByRole('button', { name: '收起侧边栏' });
    const navigation = screen.getByRole('navigation', { name: '应用导航' });
    const browserLink = screen.getByRole('link', { name: '浏览器' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(navigation.querySelector('[data-slot="tooltip-trigger"]')).not.toBeInTheDocument();
    expect(browserLink).toHaveClass('size-11');
    expect(browserLink.querySelector('svg')).toHaveAttribute('width', '22');

    await user.click(toggle);

    expect(screen.queryByRole('navigation', { name: '应用导航' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '展开侧边栏' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );

    await user.click(screen.getByRole('button', { name: '展开侧边栏' }));
    expect(screen.getByRole('navigation', { name: '应用导航' })).toBeInTheDocument();
  });

  it('returns to login after the user signs out', async () => {
    const user = userEvent.setup();
    render(App);

    await user.click(screen.getByRole('link', { name: /用户中心/ }));
    await user.click(await screen.findByRole('button', { name: '退出登录' }));

    const loginHeading = await screen.findByRole('heading', { name: '登录' });
    expect(loginHeading.closest('[data-motion="page"]')).toBeInTheDocument();
    expect(localStorage.getItem('hotel-butler.auth-session')).toBeNull();
  });

  it('opens the browser workspace after login even when the previous hash was profile', async () => {
    localStorage.removeItem('hotel-butler.auth-session');
    window.location.hash = '#/profile';
    const user = userEvent.setup();
    render(App);

    await user.type(screen.getByRole('textbox', { name: '手机号' }), '13800138000');
    await user.click(screen.getByRole('button', { name: '获取验证码' }));
    await user.type(screen.getByRole('textbox', { name: '验证码' }), '123456');
    await user.click(screen.getByRole('checkbox', { name: '我已阅读并同意用户协议与隐私政策' }));
    await user.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByRole('button', { name: '携程酒店 eBooking' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/');
    expect(screen.queryByRole('heading', { name: '用户中心' })).not.toBeInTheDocument();
  });

  it('allows cookies to be imported again from settings', async () => {
    const user = userEvent.setup();
    render(App);

    await user.click(await screen.findByRole('link', { name: '设置' }));
    await user.click(await screen.findByRole('button', { name: '已登录 Cookie 列表' }));
    await user.click(await screen.findByRole('button', { name: '导入 Cookie' }));

    expect(await screen.findByRole('dialog', { name: '从浏览器导入 Cookie' })).toBeVisible();
    expect(screen.getByRole('radio', { name: /QQ 浏览器/ })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /360 安全浏览器/ })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /搜狗高速浏览器/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '开始导入' }));

    expect(importCookies).toHaveBeenCalledWith('firefox');
    expect(await screen.findByText('已从 Mozilla Firefox 导入 8 个 Cookie')).toBeVisible();
    expect(
      screen.queryByRole('dialog', { name: '从浏览器导入 Cookie' })?.getAttribute('data-state'),
    ).not.toBe('open');
  });
});
