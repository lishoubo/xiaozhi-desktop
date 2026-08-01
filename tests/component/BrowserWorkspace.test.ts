import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BrowserWorkspace from '../../src/renderer/components/browser/BrowserWorkspace.svelte';

describe('BrowserWorkspace', () => {
  const create = vi.fn(async (channelId: string, url: string) => ({
    id: `${channelId}-tab`,
    channelId,
    title: channelId === 'ctrip' ? '携程后台' : '飞猪后台',
    url,
    canGoBack: false,
    canGoForward: false,
    loading: false,
  }));
  const activate = vi.fn();
  const acknowledgeInterception = vi.fn();
  const listCookieSources = vi.fn();
  const importCookies = vi.fn();
  let requestInterceptedListener: (() => void) | null = null;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('hotel-butler.cookie-import-prompted', 'true');
    create.mockClear();
    activate.mockClear();
    acknowledgeInterception.mockReset();
    requestInterceptedListener = null;
    listCookieSources.mockReset();
    importCookies.mockReset();
    listCookieSources.mockResolvedValue([
      { id: 'edge', name: 'Microsoft Edge' },
      { id: 'chrome', name: 'Google Chrome' },
    ]);
    importCookies.mockResolvedValue({ imported: 12, failed: 0 });
    Object.defineProperty(window, 'hotelButler', {
      configurable: true,
      value: {
        browser: {
          create,
          activate,
          acknowledgeInterception,
          close: vi.fn(),
          goBack: vi.fn(),
          goForward: vi.fn(),
          hide: vi.fn(),
          list: vi.fn().mockResolvedValue([]),
          reload: vi.fn(),
          setBounds: vi.fn(),
          onStateChanged: vi.fn(() => vi.fn()),
          onRequestIntercepted: vi.fn((listener: () => void) => {
            requestInterceptedListener = listener;
            return vi.fn();
          }),
        },
        cookies: { import: importCookies, listSources: listCookieSources },
      },
    });
  });

  it('keeps a separate tab set for each OTA shortcut', async () => {
    const user = userEvent.setup();
    const { container } = render(BrowserWorkspace);

    expect(await screen.findByRole('tab', { name: '携程后台' })).toBeInTheDocument();
    const animate = vi.mocked(Element.prototype.animate);
    animate.mockClear();
    for (const image of container.querySelectorAll('img')) {
      expect(image).toHaveAttribute('src', expect.stringMatching(/^data:image\/png;base64,/));
    }

    await user.click(screen.getByRole('button', { name: '飞猪酒店商家' }));
    expect(await screen.findByRole('tab', { name: '飞猪后台' })).toBeInTheDocument();
    expect(animate).toHaveBeenCalled();
    expect(screen.queryByRole('tab', { name: '携程后台' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '携程酒店 eBooking' }));
    expect(await screen.findByRole('tab', { name: '携程后台' })).toBeInTheDocument();
    expect(create).toHaveBeenCalledTimes(2);
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
    render(BrowserWorkspace);

    await user.click(await screen.findByRole('button', { name: '导入 Cookie' }));

    expect(await screen.findByRole('dialog', { name: '从浏览器导入 Cookie' })).toBeVisible();
    expect(listCookieSources).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('radio', { name: 'Microsoft Edge' }));
    await user.click(screen.getByRole('button', { name: '开始导入' }));

    const importAlert = await screen.findByRole('alert');
    expect(importAlert).toHaveTextContent('Cookie 导入失败，请稍后重试');
    expect(importAlert).toHaveAttribute('data-slot', 'alert');
    expect(importAlert.querySelector('svg')).toBeInTheDocument();
    expect(
      screen.queryByText(/Error invoking|remote method|cookies:import/i),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '开始导入' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '无法读取浏览器 Cookie，请允许访问后重试',
    );
    expect(
      screen.queryByText(/Error invoking|remote method|cookies:import/i),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '开始导入' }));

    expect(importCookies).toHaveBeenCalledWith('edge');
    expect(await screen.findByText('已从 Microsoft Edge 导入 12 个 Cookie')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '完成' }));

    expect(screen.queryByRole('dialog', { name: '从浏览器导入 Cookie' })).not.toBeInTheDocument();
    expect(localStorage.getItem('hotel-butler.cookie-import-prompted')).toBe('true');
    expect(create).toHaveBeenCalledWith('ctrip', expect.any(String));
  });

  it('shows safe, accessible recovery feedback when a browser tab cannot be opened', async () => {
    create.mockRejectedValueOnce(
      new Error("Error invoking remote method 'browser:create': /Users/private/app-data"),
    );
    render(BrowserWorkspace);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('页面打开失败，请重试');
    expect(alert.querySelector('svg')).toBeInTheDocument();
    expect(
      screen.queryByText(/remote method|Users\/private|browser:create/i),
    ).not.toBeInTheDocument();
  });

  it('confirms an intercepted embedded-browser request with an Alert Dialog', async () => {
    const user = userEvent.setup();
    render(BrowserWorkspace);
    await screen.findByRole('tab', { name: '携程后台' });

    requestInterceptedListener?.();

    const alertDialog = await screen.findByRole('alertdialog', { name: '请求拦截成功' });
    expect(alertDialog).toHaveTextContent('已拦截携程接口请求：/restapi/soa2/**');
    expect(alertDialog.querySelector('svg')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '知道了' }));

    expect(acknowledgeInterception).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('recovers when the existing browser tab list cannot be loaded', async () => {
    Object.defineProperty(window.hotelButler.browser, 'list', {
      configurable: true,
      value: vi.fn().mockRejectedValue(new Error('IPC list failure')),
    });

    render(BrowserWorkspace);

    expect(await screen.findByRole('alert')).toHaveTextContent('浏览器工作区加载失败，请重试');
    expect(screen.queryByText(/IPC list failure/)).not.toBeInTheDocument();
  });
});
