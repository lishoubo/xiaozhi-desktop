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

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('hotel-butler.cookie-import-prompted', 'true');
    create.mockClear();
    activate.mockClear();
    Object.defineProperty(window, 'hotelButler', {
      configurable: true,
      value: {
        browser: {
          create,
          activate,
          close: vi.fn(),
          goBack: vi.fn(),
          goForward: vi.fn(),
          hide: vi.fn(),
          list: vi.fn().mockResolvedValue([]),
          reload: vi.fn(),
          setBounds: vi.fn(),
          onStateChanged: vi.fn(() => vi.fn()),
        },
        cookies: { import: vi.fn() },
      },
    });
  });

  it('keeps a separate tab set for each OTA shortcut', async () => {
    const user = userEvent.setup();
    const { container } = render(BrowserWorkspace);

    expect(await screen.findByRole('tab', { name: '携程后台' })).toBeInTheDocument();
    for (const image of container.querySelectorAll('img')) {
      expect(image).toHaveAttribute('src', expect.stringMatching(/^data:image\/png;base64,/));
    }

    await user.click(screen.getByRole('button', { name: '飞猪酒店商家' }));
    expect(await screen.findByRole('tab', { name: '飞猪后台' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: '携程后台' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '携程酒店 eBooking' }));
    expect(await screen.findByRole('tab', { name: '携程后台' })).toBeInTheDocument();
    expect(create).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(activate).toHaveBeenCalledWith('ctrip-tab'));
  });
});
