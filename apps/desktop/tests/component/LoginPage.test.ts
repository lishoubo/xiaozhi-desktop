import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LoginPage from '../../src/renderer/pages/LoginPage.svelte';
import AppNotificationCenter from '../../src/renderer/components/layout/AppNotificationCenter.svelte';
import { clearAppNotifications } from '../../src/renderer/notifications';

const employee = {
  id: '2',
  orgId: '42',
  username: 'desktop-demo',
  fullName: '桌面体验员工',
  phone: '13800138000',
  roleCode: 'FRONT_DESK',
} as const;
const requestPhoneCode = vi.fn();
const loginWithPhoneCode = vi.fn();

beforeEach(() => {
  clearAppNotifications();
  requestPhoneCode.mockReset().mockResolvedValue({ accepted: true, expiresInSeconds: 300 });
  loginWithPhoneCode.mockReset().mockResolvedValue(employee);
  Object.defineProperty(window, 'hotelButler', {
    configurable: true,
    value: { auth: { requestPhoneCode, loginWithPhoneCode } },
  });
});

describe('LoginPage', () => {
  it('validates the phone, six-digit code and agreement before logging in', async () => {
    const user = userEvent.setup();
    const onLogin = vi.fn();
    render(AppNotificationCenter);
    render(LoginPage, { onLogin });

    await user.click(screen.getByRole('button', { name: '登录' }));
    const validationAlert = screen.getByRole('alert');
    expect(validationAlert).toHaveTextContent('请输入正确的 11 位手机号');
    expect(validationAlert).toHaveAttribute('data-slot', 'alert');
    expect(validationAlert.querySelector('svg')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: '手机号' }), '13800138000');
    await user.click(screen.getByRole('button', { name: '获取验证码' }));
    const countdownButton = screen.getByRole('button', { name: /秒后重新获取/ });
    expect(countdownButton).toBeDisabled();
    expect(countdownButton).toHaveClass('text-[11px]');
    expect(countdownButton).not.toHaveClass('text-xs');
    expect(countdownButton).not.toHaveClass('text-sm');

    expect(requestPhoneCode).toHaveBeenCalledWith('13800138000');
    await user.type(screen.getByRole('textbox', { name: '验证码' }), '654321');
    await user.click(screen.getByRole('button', { name: '登录' }));
    expect(screen.getByText('请先阅读并同意用户协议与隐私政策')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /我已阅读并同意/ }));
    await user.click(screen.getByRole('button', { name: '登录' }));

    expect(loginWithPhoneCode).toHaveBeenCalledWith('13800138000', '654321');
    expect(onLogin).toHaveBeenCalledWith(employee);
    expect(screen.getByText(/临时阶段任意 6 位验证码/)).toBeInTheDocument();
  });

  it('starts no countdown and shows a safe error when the server rejects code delivery', async () => {
    requestPhoneCode.mockRejectedValue(new Error('private transport details'));
    const user = userEvent.setup();
    render(AppNotificationCenter);
    render(LoginPage, { onLogin: vi.fn() });

    await user.type(screen.getByRole('textbox', { name: '手机号' }), '13800138000');
    await user.click(screen.getByRole('button', { name: '获取验证码' }));

    expect(await screen.findByText('验证码发送失败，请重试')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '获取验证码' })).toBeEnabled();
    expect(screen.queryByText(/private transport details/)).not.toBeInTheDocument();
  });

  it('uses an accessible policy dialog and avoids implementation terminology', async () => {
    const user = userEvent.setup();
    render(LoginPage, { onLogin: vi.fn() });

    expect(screen.queryByText(/Mock|Electron|后端/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '《隐私政策》' }));
    expect(screen.getByRole('dialog', { name: '小智酒店管家隐私政策' })).toBeVisible();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
