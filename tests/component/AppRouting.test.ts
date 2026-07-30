import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/renderer/App.svelte';

const listSettings = vi.fn().mockResolvedValue([]);

describe('App routing and query integration', () => {
  beforeEach(() => {
    window.location.hash = '';
    listSettings.mockClear();

    Object.defineProperty(window, 'hotelButler', {
      configurable: true,
      value: {
        versions: {
          chrome: '1',
          electron: '2',
          node: '3',
        },
        settings: {
          list: listSettings,
          get: vi.fn(),
          set: vi.fn(),
          delete: vi.fn(),
        },
      },
    });
  });

  it('navigates to settings and loads cached Electron data', async () => {
    const user = userEvent.setup();
    render(App);

    expect(await screen.findByRole('heading', { name: '开始浏览' })).toBeInTheDocument();
    expect(screen.getByText('在地址栏输入网址即可开始。')).toBeInTheDocument();
    expect(screen.queryByText('Svelte renderer 已连接')).not.toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: '设置' }));

    expect(await screen.findByRole('heading', { name: '设置' })).toBeInTheDocument();
    expect(await screen.findByText('目前还没有保存任何设置。')).toBeInTheDocument();
    expect(screen.queryByText(/TanStack Query/)).not.toBeInTheDocument();
    expect(screen.queryByText(/SQLite/)).not.toBeInTheDocument();
    expect(listSettings).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe('#/settings');
  });
});
