import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserTab } from '../../src/shared/browser';
import BrowserWorkspace from '../../src/renderer/components/browser/BrowserWorkspace.svelte';
import AppNotificationCenter from '../../src/renderer/components/layout/AppNotificationCenter.svelte';
import { clearAppNotifications } from '../../src/renderer/notifications';

describe('BrowserWorkspace', () => {
  const defaultStartLogin = async ({
    channelId,
    url,
  }: {
    channelId: string;
    environment: string;
    url: string;
  }) =>
    Promise.resolve({
      id: `${channelId}-tab`,
      channelId,
      title: channelId === 'ctrip' ? '携程后台' : '飞猪后台',
      url,
      canGoBack: false,
      canGoForward: false,
      loading: false,
      partitionName: `persist:xiaozhi:dev:${channelId}:stub`,
    });
  const startLogin = vi.fn(defaultStartLogin);
  const activate = vi.fn();
  const acknowledgeInterception = vi.fn();
  const listCookieSources = vi.fn();
  const importCookies = vi.fn();
  const listByChannel = vi.fn();
  const openExisting = vi.fn();
  let requestInterceptedListener: (() => void) | null = null;
  let stateChangedListener: ((tab: BrowserTab) => void) | null = null;
  let accountBoundListener: ((event: { channel: string }) => void) | null = null;

  function renderWorkspace() {
    render(AppNotificationCenter);
    return render(BrowserWorkspace);
  }

  function releaseDialogInteractionLock(): void {
    document.body.style.removeProperty('margin-right');
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('pointer-events');
    document.body.style.removeProperty('user-select');
    document.body.style.removeProperty('--scrollbar-width');
  }

  async function openCtripViaAddAccount(): Promise<void> {
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '添加账号' }));
    await screen.findByRole('tab', { name: '携程后台' });
  }

  beforeEach(() => {
    document.body.removeAttribute('style');
    localStorage.clear();
    clearAppNotifications();
    localStorage.setItem('hotel-butler.cookie-import-prompted', 'true');
    startLogin.mockReset();
    startLogin.mockImplementation(defaultStartLogin);
    activate.mockClear();
    acknowledgeInterception.mockReset();
    requestInterceptedListener = null;
    stateChangedListener = null;
    accountBoundListener = null;
    listCookieSources.mockReset();
    importCookies.mockReset();
    listByChannel.mockReset();
    listByChannel.mockResolvedValue([]);
    openExisting.mockReset();
    listCookieSources.mockResolvedValue([
      { id: 'edge', name: 'Microsoft Edge' },
      { id: 'chrome', name: 'Google Chrome' },
      { id: 'firefox', name: 'Mozilla Firefox' },
      { id: 'safari', name: 'Safari' },
      { id: 'qq', name: 'QQ 浏览器' },
      { id: '360', name: '360 安全浏览器' },
      { id: 'sogou', name: '搜狗高速浏览器' },
    ]);
    importCookies.mockResolvedValue({ imported: 12, failed: 0 });
    Object.defineProperty(window, 'hotelButler', {
      configurable: true,
      value: {
        browser: {
          activate,
          acknowledgeInterception,
          close: vi.fn(),
          goBack: vi.fn(),
          goForward: vi.fn(),
          hide: vi.fn(),
          list: vi.fn().mockResolvedValue([]),
          reload: vi.fn(),
          setBounds: vi.fn(),
          onStateChanged: vi.fn((listener: (tab: BrowserTab) => void) => {
            stateChangedListener = listener;
            return vi.fn();
          }),
          onRequestIntercepted: vi.fn((listener: () => void) => {
            requestInterceptedListener = listener;
            return vi.fn();
          }),
        },
        cookies: { import: importCookies, listSources: listCookieSources },
        otaAccount: {
          startLogin,
          listByChannel,
          openExisting,
          onAccountBound: vi.fn((listener: (event: { channel: string }) => void) => {
            accountBoundListener = listener;
            return vi.fn();
          }),
        },
      },
    });
  });

  it('keeps a separate tab set for each OTA shortcut', async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    await openCtripViaAddAccount();
    const animate = vi.mocked(Element.prototype.animate);
    animate.mockClear();
    for (const image of container.querySelectorAll('img')) {
      expect(image).toHaveAttribute('src', expect.stringMatching(/^data:image\/png;base64,/));
    }

    await user.click(screen.getByRole('button', { name: '飞猪酒店商家' }));
    expect(screen.queryByRole('tab', { name: '携程后台' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '添加账号' }));
    expect(await screen.findByRole('tab', { name: '飞猪后台' })).toBeInTheDocument();
    expect(animate).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '携程酒店 eBooking' }));
    expect(await screen.findByRole('tab', { name: '携程后台' })).toBeInTheDocument();
    expect(startLogin).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(activate).toHaveBeenCalledWith('ctrip-tab'));
  });

  it('imports cookies from a browser selected in a dialog and closes after confirmation', async () => {
    localStorage.removeItem('hotel-butler.cookie-import-prompted');
    importCookies
      .mockRejectedValueOnce(
        new Error("Error invoking remote method 'cookies:import': security command failed"),
      )
      .mockResolvedValueOnce({
        imported: 0,
        failed: 0,
        error: '无法读取浏览器 Cookie，请允许访问后重试',
      })
      .mockResolvedValueOnce({ imported: 12, failed: 0 });
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(await screen.findByRole('button', { name: '导入 Cookie' }));

    expect(await screen.findByRole('dialog', { name: '从浏览器导入 Cookie' })).toBeVisible();
    expect(listCookieSources).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('radio', { name: 'Microsoft Edge' }));
    await user.click(screen.getByRole('button', { name: '开始导入' }));

    const importAlert = await screen.findByText('Cookie 导入失败，请稍后重试。');
    expect(importAlert.closest('[data-slot="alert"]')).toBeInTheDocument();
    expect(
      screen.queryByText(/Error invoking|remote method|cookies:import/i),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '开始导入' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: '开始导入' }));

    expect(await screen.findByText('无法读取浏览器 Cookie，请允许访问后重试')).toBeInTheDocument();
    expect(
      screen.queryByText(/Error invoking|remote method|cookies:import/i),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '开始导入' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: '开始导入' }));

    expect(importCookies).toHaveBeenCalledWith('edge');
    expect(await screen.findByText('已从 Microsoft Edge 导入 12 个 Cookie')).toBeVisible();

    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: '从浏览器导入 Cookie' })).toHaveAttribute(
        'data-state',
        'closed',
      ),
    );
    releaseDialogInteractionLock();
    expect(localStorage.getItem('hotel-butler.cookie-import-prompted')).toBe('true');
    expect(startLogin).not.toHaveBeenCalled();
  });

  it('shows safe, accessible recovery feedback when a browser tab cannot be opened', async () => {
    startLogin.mockRejectedValueOnce(
      new Error("Error invoking remote method 'ota-account:start-login': /Users/private/app-data"),
    );
    renderWorkspace();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '添加账号' }));

    const alert = (await screen.findByText('页面打开失败，请重试')).closest('[data-slot="alert"]');
    expect(alert).toHaveTextContent('页面打开失败，请重试');
    expect(alert?.querySelector('svg')).toBeInTheDocument();
    expect(
      screen.queryByText(/remote method|Users\/private|ota-account:start-login/i),
    ).not.toBeInTheDocument();
  });

  it('uses the shared Spinner while the active page is refreshing', async () => {
    renderWorkspace();
    await openCtripViaAddAccount();

    stateChangedListener?.({
      id: 'ctrip-tab',
      channelId: 'ctrip',
      title: '携程后台',
      url: 'https://ebooking.ctrip.com/',
      canGoBack: false,
      canGoForward: false,
      loading: true,
      partitionName: 'persist:xiaozhi:dev:ctrip:stub',
    });

    const refreshButton = screen.getByRole('button', { name: '刷新' });
    expect(await screen.findByLabelText('页面加载中')).toHaveAttribute('data-slot', 'spinner');
    expect(refreshButton.querySelector('[data-slot="spinner"]')).toBeInTheDocument();
  });

  it('reports an intercepted embedded-browser request as a non-blocking notification', async () => {
    renderWorkspace();
    await openCtripViaAddAccount();

    requestInterceptedListener?.();

    const notice = await screen.findByText('已拦截携程接口请求：/restapi/soa2/**');
    expect(notice.closest('[data-slot="alert"]')).toHaveTextContent('请求拦截成功');
    expect(acknowledgeInterception).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('recovers when the existing browser tab list cannot be loaded', async () => {
    Object.defineProperty(window.hotelButler.browser, 'list', {
      configurable: true,
      value: vi.fn().mockRejectedValue(new Error('IPC list failure')),
    });

    renderWorkspace();

    expect(await screen.findByText('浏览器工作区加载失败，请重试')).toBeInTheDocument();
    expect(screen.queryByText(/IPC list failure/)).not.toBeInTheDocument();
  });

  it('shows bound accounts for the active channel with displayName fallback', async () => {
    listByChannel.mockResolvedValue([
      {
        id: 'a1',
        credentialId: 'credential-1',
        channel: 'ctrip',
        otaHotelId: 'ctrip-1',
        otaHotelName: '银际酒店(包头)',
        partitionName: 'persist:xiaozhi:prod:ctrip:aaa',
        bindExtra: null,
        discoveredAt: 1000,
      },
      {
        id: 'a2',
        credentialId: 'credential-2',
        channel: 'ctrip',
        otaHotelId: 'ctrip-2',
        otaHotelName: null,
        partitionName: 'persist:xiaozhi:prod:ctrip:bbb',
        bindExtra: null,
        discoveredAt: 2000,
      },
    ]);

    renderWorkspace();

    expect(await screen.findByTitle('银际酒店(包头)')).toBeInTheDocument();
    expect(await screen.findByTitle('ctrip-2')).toBeInTheDocument();
    expect(listByChannel).toHaveBeenCalledWith('ctrip');
  });

  it('clicking a bound account with no open tab opens it via openExisting', async () => {
    listByChannel.mockResolvedValue([
      {
        id: 'a1',
        credentialId: 'credential-1',
        channel: 'ctrip',
        otaHotelId: 'ctrip-1',
        otaHotelName: '璞禾咖啡酒店',
        partitionName: 'persist:xiaozhi:prod:ctrip:aaa',
        bindExtra: null,
        discoveredAt: 1000,
      },
    ]);
    openExisting.mockResolvedValue({
      id: 'account-tab',
      channelId: 'ctrip',
      title: '璞禾咖啡酒店',
      url: 'https://ebooking.ctrip.com/home/mainland',
      canGoBack: false,
      canGoForward: false,
      loading: false,
      partitionName: 'persist:xiaozhi:prod:ctrip:aaa',
    });

    renderWorkspace();
    const accountButton = await screen.findByTitle('璞禾咖啡酒店');
    accountButton.click();

    expect(openExisting).toHaveBeenCalledWith('a1');
    expect(await screen.findByRole('tab', { name: '璞禾咖啡酒店' })).toBeInTheDocument();
  });

  it('clicking a bound account that already has an open tab activates it instead of opening a new one', async () => {
    listByChannel.mockResolvedValue([
      {
        id: 'a1',
        credentialId: 'credential-1',
        channel: 'ctrip',
        otaHotelId: 'ctrip-1',
        otaHotelName: '携程后台',
        partitionName: 'persist:xiaozhi:dev:ctrip:stub',
        bindExtra: null,
        discoveredAt: 1000,
      },
    ]);

    renderWorkspace();
    await openCtripViaAddAccount();
    activate.mockClear();
    const accountButton = await screen.findByTitle('携程后台');
    accountButton.click();

    expect(openExisting).not.toHaveBeenCalled();
    await waitFor(() => expect(activate).toHaveBeenCalledWith('ctrip-tab'));
  });

  it('starts a new login from the add-account panel for the active channel', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(await screen.findByRole('button', { name: '添加账号' }));

    await waitFor(() =>
      expect(startLogin).toHaveBeenCalledWith(
        expect.objectContaining({ channelId: 'ctrip', environment: 'prod' }),
      ),
    );
  });

  it('shows only the add-account button when the channel has no bound accounts', async () => {
    listByChannel.mockResolvedValue([]);

    renderWorkspace();

    expect(await screen.findByRole('button', { name: '添加账号' })).toBeInTheDocument();
    expect(screen.getByLabelText('账号列表').querySelectorAll('button')).toHaveLength(1);
  });

  it('refreshes the accounts nav automatically when the main process reports a newly bound account', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: '添加账号' });
    listByChannel.mockClear();
    listByChannel.mockResolvedValue([
      {
        id: 'a1',
        credentialId: 'credential-1',
        channel: 'ctrip',
        otaHotelId: 'ctrip-1',
        otaHotelName: '新绑定门店',
        partitionName: 'persist:xiaozhi:dev:ctrip:stub',
        bindExtra: null,
        discoveredAt: 1000,
      },
    ]);

    accountBoundListener?.({ channel: 'ctrip' });

    expect(await screen.findByTitle('新绑定门店')).toBeInTheDocument();
    expect(listByChannel).toHaveBeenCalledWith('ctrip');
  });

  it('does not refresh the accounts nav for a bound event on a different channel', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: '添加账号' });
    listByChannel.mockClear();

    accountBoundListener?.({ channel: 'douyin' });
    await Promise.resolve();

    expect(listByChannel).not.toHaveBeenCalled();
  });
});
