/**
 * 桌面端认证 —— 调用远端 tRPC，并维护本地 session cookie 的生命周期。
 *
 * 抽出这一层的主因是 `logout`：它是「先调远端、再清本地 cookie」的有序事务，
 * 且清理必须在 `finally` 里做（远端失败也要清，否则会留下"已登出但仍带凭证"
 * 的状态）。这段逻辑原先写在 IPC handler 里，无法单独测试。
 */
import type { AppRouter, EmployeeIdentity } from '@hotel-butler/api';
import type { TRPCClient } from '@trpc/client';
import type { Cookies } from 'electron';
import type { AppLogger } from '../../shared/logging';

export const DESKTOP_SESSION_COOKIE_NAME = '__Host-xiaozhi_desktop_session';

export type AuthClient = Pick<TRPCClient<AppRouter>, 'auth'>;

export type AuthServiceDependencies = Readonly<{
  apiSession: Readonly<{ cookies: Pick<Cookies, 'remove'> }>;
  client: AuthClient;
  logger: AppLogger;
  serverOrigin: string;
}>;

export class AuthService {
  constructor(private readonly deps: AuthServiceDependencies) {}

  currentSession(): Promise<EmployeeIdentity | null> {
    return this.safeCall('current-session', '无法验证登录状态，请重试', () =>
      this.deps.client.auth.currentSession.query(),
    );
  }

  requestPhoneCode(phone: string): Promise<{ accepted: true; expiresInSeconds: number }> {
    return this.safeCall('request-code', '验证码发送失败，请重试', () =>
      this.deps.client.auth.requestPhoneCode.mutate({ phone }),
    );
  }

  loginWithPhoneCode(phone: string, code: string): Promise<EmployeeIdentity> {
    return this.safeCall('login', '登录失败，请检查手机号和验证码', () =>
      this.deps.client.auth.loginWithPhoneCode.mutate({ phone, code }),
    );
  }

  /**
   * 无论远端是否成功都要清本地 session cookie —— 远端失败时若保留 cookie，
   * 用户会停在"以为已登出、实际仍带凭证"的状态。
   */
  async logout(): Promise<{ success: true }> {
    try {
      return await this.safeCall('logout', '退出登录失败，请重试', () =>
        this.deps.client.auth.logout.mutate(),
      );
    } finally {
      await this.deps.apiSession.cookies.remove(
        this.deps.serverOrigin,
        DESKTOP_SESSION_COOKIE_NAME,
      );
    }
  }

  /** 远端失败一律转成用户可读文案，不把 tRPC 的原始错误透给渲染进程。 */
  private async safeCall<T>(
    operation: string,
    message: string,
    call: () => Promise<T>,
  ): Promise<T> {
    try {
      return await call();
    } catch (error) {
      this.deps.logger.warn('Desktop authentication operation failed', {
        operation,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      throw new Error(message);
    }
  }
}
