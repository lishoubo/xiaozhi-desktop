import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserTab, OtaCredentialDto } from '../../src/shared/browser';
import BrowserWorkspace from '../../src/renderer/components/browser/BrowserWorkspace.svelte';

const CTRIP_PARTITION = 'persist:xiaozhi:prod:ctrip:aaa';

function credential(overrides: Partial<OtaCredentialDto> = {}): OtaCredentialDto {
  return {
    id: 'credential-1',
    channel: 'ctrip',
    channelAccountId: 'ctrip-account-1',
    partitionName: CTRIP_PARTITION,
    credentialExtra: { hotelName: '银际酒店(包头)' },
    discoveredAt: 1_000,
    lastRefreshedAt: null,
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
  const listCredentialsByChannel = vi.fn();
  const openExistingCredential = vi.fn();

  function renderWorkspace() {
    return render(BrowserWorkspace);
  }

  async function releaseDialogInteractionLock(): Promise<void> {
    document.body.style.removeProperty('margin-right');
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('pointer-events');
    document.body.style.removeProperty('user-select');
    document.body.style.removeProperty('--scrollbar-width');
    await new Promise((resolve) => window.setTimeout(resolve, 30));
  }

  async function openAccountSwitcher(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: '切换登录账号' }));
    return screen.findByRole('dialog', { name: '已登录账号列表' });
  }

  async function startCtripLogin(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await openAccountSwitcher(user);
    await user.click(screen.getByRole('button', { name: '登录新渠道账号' }));
    await screen.findByRole('tab', { name: '携程后台' });
    await releaseDialogInteractionLock();
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
    listCredentialsByChannel.mockReset();
    listCredentialsByChannel.mockResolvedValue([]);
    openExistingCredential.mockReset();
    openExistingCredential.mockResolvedValue(tab({ id: 'existing-tab' }));
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
          onAccountBound: vi.fn(() => vi.fn()),
        },
        otaCredential: {
          listByChannel: listCredentialsByChannel,
          openExisting: openExistingCredential,
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
    expect(screen.getByLabelText('当前登录账号')).toHaveTextContent('携程酒店 eBooking');
    for (const image of container.querySelectorAll('nav img')) {
      expect(image).toHaveAttribute('src', expect.stringMatching(/^data:image\/png;base64,/));
    }
  });

  it('opens another tab in the current session without closing the original tab', async () => {
    listCredentialsByChannel.mockResolvedValue([credential()]);
    openExistingCredential.mockResolvedValue(tab({ id: 'ctrip-tab-2', title: '携程首页 2' }));
    const user = userEvent.setup();
    renderWorkspace();
    await startCtripLogin(user);

    await user.click(screen.getByRole('button', { name: '新建标签页' }));

    expect(openExistingCredential).toHaveBeenCalledWith('credential-1');
    expect(await screen.findByRole('tab', { name: '携程首页 2' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '携程后台' })).toBeInTheDocument();
    expect(close).not.toHaveBeenCalled();
  });

  it('switches account by opening the target partition and closing the previous tabs', async () => {
    const targetPartition = 'persist:xiaozhi:prod:ctrip:bbb';
    listCredentialsByChannel.mockResolvedValue([
      credential(),
      credential({
        id: 'credential-2',
        channelAccountId: 'ctrip-account-2',
        credentialExtra: { hotelName: '璞禾咖啡酒店' },
        partitionName: targetPartition,
        discoveredAt: 2_000,
      }),
    ]);
    openExistingCredential.mockResolvedValue(
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
    await releaseDialogInteractionLock();

    expect(openExistingCredential).toHaveBeenCalledWith('credential-2');
    await waitFor(() => expect(close).toHaveBeenCalledWith('ctrip-tab'));
    expect(await screen.findByRole('tab', { name: '璞禾咖啡酒店' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: '携程后台' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('当前登录账号')).toHaveTextContent('璞禾咖啡酒店');
  });

  it('closes the last tab and returns the account area to the current channel name', async () => {
    listCredentialsByChannel.mockResolvedValue([credential()]);
    const user = userEvent.setup();
    renderWorkspace();
    await startCtripLogin(user);

    await user.click(screen.getByRole('button', { name: '关闭 携程后台' }));

    expect(close).toHaveBeenCalledWith('ctrip-tab');
    expect(screen.queryByRole('tab', { name: '携程后台' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('当前登录账号')).toHaveTextContent('携程酒店 eBooking');
    expect(screen.getByRole('button', { name: '新建标签页' })).toBeDisabled();
  });

  it('activates the adjacent tab after closing the active tab', async () => {
    listCredentialsByChannel.mockResolvedValue([credential()]);
    openExistingCredential.mockResolvedValue(tab({ id: 'ctrip-tab-2', title: '携程首页 2' }));
    const user = userEvent.setup();
    renderWorkspace();
    await startCtripLogin(user);
    await user.click(screen.getByRole('button', { name: '新建标签页' }));

    await user.click(screen.getByRole('button', { name: '关闭 携程首页 2' }));

    expect(close).toHaveBeenCalledWith('ctrip-tab-2');
    expect(activate).toHaveBeenCalledWith('ctrip-tab');
    expect(screen.getByRole('tab', { name: '携程后台' })).toHaveAttribute('aria-selected', 'true');
  });
});
