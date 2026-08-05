import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import AppNotificationCenter from '../../src/renderer/components/layout/AppNotificationCenter.svelte';
import HotelManagementPage from '../../src/renderer/pages/HotelManagementPage.svelte';
import { clearAppNotifications } from '../../src/renderer/notifications';

describe('HotelManagementPage', () => {
  beforeEach(() => clearAppNotifications());

  it('shows one compact row per hotel and reveals OTA details on demand', async () => {
    const user = userEvent.setup();
    render(HotelManagementPage);

    expect(screen.getByRole('heading', { name: '酒店管理' })).toBeInTheDocument();
    const hotelRows = screen.getAllByTestId('managed-hotel');
    expect(hotelRows).toHaveLength(3);
    for (const row of hotelRows) expect(row).toHaveAttribute('data-layout', 'single-row');
    expect(screen.getAllByTestId('bound-ota-account')).toHaveLength(4);
    expect(screen.getByRole('heading', { name: '上海云栖酒店' })).toBeInTheDocument();
    expect(screen.getByText('上海')).toBeInTheDocument();
    expect(screen.getByText('携程酒店 eBooking')).toBeInTheDocument();
    expect(screen.getByText('抖音来客')).toBeInTheDocument();
    expect(screen.queryByText('OTA 酒店 ID')).not.toBeInTheDocument();
    expect(screen.queryByText('SHYQ-310042')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '查看携程酒店 eBooking账号详情' }));
    expect(screen.getByText('OTA 酒店 ID')).toBeInTheDocument();
    expect(screen.getByText('SHYQ-310042')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '查看抖音来客账号详情' }));
    expect(screen.getByText('抖音商户 ID')).toBeInTheDocument();
    expect(screen.getByText('7129084416')).toBeInTheDocument();
    expect(screen.getByText('登录已失效')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新登录抖音来客账号' })).toBeInTheDocument();
    expect(screen.getByText('暂未绑定')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /新增绑定账号 -/ })).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: /绑定账号管理 -/ })).toHaveLength(3);
  });

  it('provides explicit mock feedback for hotel and account operations', async () => {
    const user = userEvent.setup();
    render(AppNotificationCenter);
    render(HotelManagementPage);

    await user.click(screen.getByRole('button', { name: '新增绑定账号 - 上海云栖酒店' }));
    expect(
      await screen.findByText('上海云栖酒店的新增绑定账号入口暂未连接服务端。'),
    ).toBeInTheDocument();
    expect(screen.getByText('设计预览')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '查看抖音来客账号详情' }));
    await user.click(screen.getByRole('button', { name: '重新登录抖音来客账号' }));
    expect(await screen.findByText('抖音来客 · 重新登录')).toBeInTheDocument();
    expect(
      screen.getByText('重新登录流程暂未连接服务端，当前仅展示页面设计。'),
    ).toBeInTheDocument();
  });
});
