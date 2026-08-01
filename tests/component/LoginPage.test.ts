import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import LoginPage from '../../src/renderer/pages/LoginPage.svelte';

describe('LoginPage', () => {
  it('validates the phone, six-digit code and agreement before logging in', async () => {
    const user = userEvent.setup();
    const onLogin = vi.fn();
    render(LoginPage, { onLogin });

    await user.click(screen.getByRole('button', { name: '登录' }));
    const validationAlert = screen.getByRole('alert');
    expect(validationAlert).toHaveTextContent('请输入正确的 11 位手机号');
    expect(validationAlert).toHaveAttribute('data-slot', 'alert');
    expect(validationAlert.querySelector('svg')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: '手机号' }), '13800138000');
    await user.click(screen.getByRole('button', { name: '获取验证码' }));
    expect(screen.getByRole('button', { name: /秒后重新获取/ })).toBeDisabled();

    await user.type(screen.getByRole('textbox', { name: '验证码' }), '123456');
    await user.click(screen.getByRole('button', { name: '登录' }));
    expect(screen.getByText('请先阅读并同意用户协议与隐私政策')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /我已阅读并同意/ }));
    await user.click(screen.getByRole('button', { name: '登录' }));

    expect(onLogin).toHaveBeenCalledWith('13800138000');
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
