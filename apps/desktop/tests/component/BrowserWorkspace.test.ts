import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserTab, OtaAccountDto } from '../../src/shared/browser';
import BrowserWorkspace from '../../src/renderer/components/browser/BrowserWorkspace.svelte';

const CTRIP_PARTITION = 'persist:xiaozhi:prod:ctrip:aaa';

function account(overrides: Partial<OtaAccountDto> = {}): OtaAccountDto {
  return {
    id: 'account-1',
    credentialId: 'credential-1',
    channel: 'ctrip',
    otaHotelId: 'ctrip-1',
    otaHotelName: '银际酒店(包头)',
    partitionName: CTRIP_PARTITION,
    bindExtra: null,
    discoveredAt: 1_000,
    ...overrides,
  };
}

function tab(overrides: Partial<BrowserTab> = {}): BrowserTab {
  return {
    id: 'ctrip-tab',
    channelId: 'ctrip',
    title: '携程后台',
    url: 'https://ebooking.ctrip.com/',
    canGoBack: false,
    canGoForward: false,
    loading: false,
    partitionName: CTRIP_PARTITION,
    ...overrides,
  };
}

describe('BrowserWorkspace', () => {
  const startLogin = vi.fn();
  const activate = vi.fn();
  const close = vi.fn();
  const hide = vi.fn();
  const listByChannel = vi.fn();
  const openExisting = vi.fn();

  function renderWorkspace() {
    return render(BrowserWorkspace);
  }

  function releaseDialogInteractionLock(): void {
    document.body.style.removeProperty('margin-right');
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('pointer-events');
    document.body.style.removeProperty('user-select');
    document.body.style.removeProperty('--scrollbar-width');
  }

  async function openAccountSwitcher(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: '切换登录账号' }));
    return screen.findByRole('dialog', { name: '已登录账号列表' });
  }

  async function startCtripLogin(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await openAccountSwitcher(user);
    await user.click(screen.getByRole('button', { name: '登录新渠道账号' }));
    await screen.findByRole('tab', { name: '携程后台' });
    releaseDialogInteractionLock();
  }

  beforeEach(() => {
    document.body.removeAttribute('style');
    localStorage.clear();
    localStorage.setItem('hotel-butler.cookie-import-prompted', 'true');
    startLogin.mockReset();
    startLogin.mockImplementation(async ({ channelId, url }) =>
      tab({
        id: `${channelId}-tab`,
        channelId,
        title: channelId === 'ctrip' ? '携程后台' : '飞猪后台',
        url,
        partitionName: `persist:xiaozhi:prod:${channelId}:aaa`,
      }),
    );
    activate.mockReset();
    close.mockReset();
    hide.mockReset();
    listByChannel.mockReset();
    listByChannel.mockResolvedValue([]);
    openExisting.mockReset();
    openExisting.mockResolvedValue(tab({ id: 'existing-tab' }));
    Object.defineProperty(window, 'hotelButler', {
      configurable: true,
      value: {
        browser: {
          activate,
          acknowledgeInterception: vi.fn(),
          close,
          goBack: vi.fn(),
          goForward: vi.fn(),
          hide,
          list: vi.fn().mockResolvedValue([]),
          reload: vi.fn(),
          setBounds: vi.fn(),
          onStateChanged: vi.fn(() => vi.fn()),
          onRequestIntercepted: vi.fn(() => vi.fn()),
        },
        cookies: {
          import: vi.fn(),
          listSources: vi.fn().mockResolvedValue([]),
        },
        otaAccount: {
          startLogin,
          listByChannel,
          openExisting,
          onAccountBound: vi.fn(() => vi.fn()),
        },
      },
    });
  });

  it('renders the two-level header with channel names and separate page/account controls', () => {
    const { container } = renderWorkspace();

    expect(screen.getByRole('button', { name: '携程酒店 eBooking' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '美团酒店' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '抖音来客' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '新建标签页' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '切换登录账号' })).toBeEnabled();
    expect(screen.getByLabelText('当前登录账号')).toHaveTextContent('未选择账号');
    for (const image of container.querySelectorAll('nav img')) {
      expect(image).toHaveAttribute('src', expect.stringMatching(/^data:image\/png;base64,/));
    }
  });

  it('opens another tab in the current session without closing the original tab', async () => {
    listByChannel.mockResolvedValue([account()]);
    openExisting.mockResolvedValue(tab({ id: 'ctrip-tab-2', title: '携程首页 2' }));
    const user = userEvent.setup();
    renderWorkspace();
    await startCtripLogin(user);

    await user.click(screen.getByRole('button', { name: '新建标签页' }));

    expect(openExisting).toHaveBeenCalledWith('account-1');
    expect(await screen.findByRole('tab', { name: '携程首页 2' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '携程后台' })).toBeInTheDocument();
    expect(close).not.toHaveBeenCalled();
  });

  it('switches account by opening the target partition and closing the previous tabs', async () => {
    const targetPartition = 'persist:xiaozhi:prod:ctrip:bbb';
    listByChannel.mockResolvedValue([
      account(),
      account({
        id: 'account-2',
        credentialId: 'credential-2',
        otaHotelId: 'ctrip-2',
        otaHotelName: '璞禾咖啡酒店',
        partitionName: targetPartition,
        discoveredAt: 2_000,
      }),
    ]);
    openExisting.mockResolvedValue(
      tab({
        id: 'target-tab',
        title: '璞禾咖啡酒店',
        partitionName: targetPartition,
      }),
    );
    const user = userEvent.setup();
    renderWorkspace();
    await startCtripLogin(user);

    const dialog = await openAccountSwitcher(user);
    await user.click(within(dialog).getByRole('button', { name: /璞禾咖啡酒店/ }));
    releaseDialogInteractionLock();

    expect(openExisting).toHaveBeenCalledWith('account-2');
    await waitFor(() => expect(close).toHaveBeenCalledWith('ctrip-tab'));
    expect(await screen.findByRole('tab', { name: '璞禾咖啡酒店' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: '携程后台' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('当前登录账号')).toHaveTextContent('璞禾咖啡酒店');
  });
});
