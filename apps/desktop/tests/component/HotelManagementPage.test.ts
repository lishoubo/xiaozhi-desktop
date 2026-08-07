import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HotelManagementPage from '../../src/renderer/pages/HotelManagementPage.svelte';
import { clearAppNotifications } from '../../src/renderer/notifications';

const snapshot = {
  hotels: [
    { id: 1001, name: '上海云栖酒店', status: 1 },
    { id: 1002, name: '杭州西溪悦榕酒店', status: 1 },
    { id: 1003, name: '苏州平江府', status: 1 },
  ],
  otaAccounts: [
    {
      id: 30101,
      hotelId: 1001,
      otaHotelId: 'SHYQ-310042',
      otaHotelName: '上海云栖酒店（南京西路店）',
      status: 'BOUND',
      source: 'ctrip',
      bindExtra: null,
    },
    {
      id: 30102,
      hotelId: 1001,
      otaHotelId: '742966120',
      otaHotelName: '上海云栖酒店',
      status: 'LOGIN_EXPIRED',
      source: 'douyin',
      bindExtra: { merchantGroupId: '7129084416' },
    },
  ],
};

const load = vi.fn();

beforeEach(() => {
  clearAppNotifications();
  load.mockReset();
  load.mockResolvedValue(snapshot);
  Object.defineProperty(window, 'hotelButler', {
    configurable: true,
    value: {
      hotelManagement: {
        load,
        createHotel: vi.fn(),
        deleteHotel: vi.fn(),
        unbindOtaAccount: vi.fn(),
      },
    },
  });
});

describe('HotelManagementPage', () => {
  it('loads remote hotels and OTA accounts, revealing details on demand', async () => {
    const user = userEvent.setup();
    render(HotelManagementPage);

    expect(screen.getByRole('heading', { name: '酒店管理' })).toBeInTheDocument();
    const hotelRows = await screen.findAllByTestId('managed-hotel');
    expect(hotelRows).toHaveLength(3);
    expect(screen.getAllByTestId('bound-ota-account')).toHaveLength(2);
    expect(screen.getByRole('heading', { name: '上海云栖酒店' })).toBeInTheDocument();
    expect(screen.queryByText('OTA 酒店 ID')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '查看携程酒店 eBooking账号详情' }));
    expect(screen.getByText('OTA 酒店 ID')).toBeInTheDocument();
    expect(screen.getByText('SHYQ-310042')).toBeInTheDocument();
  });

  it('shows a retryable error state when loading fails', async () => {
    load.mockReset();
    load.mockRejectedValue(new Error('network down'));
    render(HotelManagementPage);

    expect(await screen.findByText('未能读取酒店管理数据，请重试。')).toBeInTheDocument();
  });
});
