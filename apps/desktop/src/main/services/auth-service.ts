/**
 * 桌面端认证 —— 调用远端 tRPC，并维护本地 session cookie 的生命周期。
 *
 * 抽出这一层的主因是 `logout`：它是「先调远端、再清本地 cookie」的有序事务，
 * 且清理必须在 `finally` 里做（远端失败也要清，否则会留下"已登出但仍带凭证"
 * 的状态）。这段逻辑原先写在 IPC handler 里，无法单独测试。
 */
import type { EmployeeIdentity } from '@hotel-butler/api';
import type { Cookies } from 'electron';
import { safeLogErrorDetails, type AppLogger } from '../../shared/logging';

export const DESKTOP_SESSION_COOKIE_NAME = '__Host-xiaozhi_desktop_session';

export type AuthClient = Readonly<{
  auth: Readonly<{
    currentSession: Readonly<{ query(): Promise<EmployeeIdentity | null> }>;
    loginWithPhoneCode: Readonly<{
      mutate(input: { phone: string; code: string }): Promise<EmployeeIdentity>;
    }>;
    logout: Readonly<{ mutate(): Promise<{ success: true }> }>;
    requestPhoneCode: Readonly<{
      mutate(input: { phone: string }): Promise<{ accepted: true; expiresInSeconds: number }>;
    }>;
  }>;
  system: Readonly<{
    health: Readonly<{
      query(): Promise<{
        status: 'ok';
        authentication?: { phoneIdentitySourceConfigured: boolean };
      }>;
    }>;
  }>;
}>;

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

  async requestPhoneCode(phone: string): Promise<{ accepted: true; expiresInSeconds: number }> {
    await this.ensurePhoneIdentitySource();
    return this.safeCall('request-code', '验证码发送失败，请重试', () =>
      this.deps.client.auth.requestPhoneCode.mutate({ phone }),
    );
  }

  async loginWithPhoneCode(phone: string, code: string): Promise<EmployeeIdentity> {
    await this.ensurePhoneIdentitySource();
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

  private async ensurePhoneIdentitySource(): Promise<void> {
    const health = await this.safeCall(
      'phone-capabilities',
      '无法确认手机号登录服务状态，请重试',
      () => this.deps.client.system.health.query(),
    );
    if (health.authentication?.phoneIdentitySourceConfigured !== true) {
      const error = new Error('当前服务器未配置手机号身份数据源，请联系管理员');
      this.logFailure('phone-capabilities', error);
      throw error;
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
      this.logFailure(operation, error);
      throw new Error(message);
    }
  }

  private logFailure(operation: string, error: unknown): void {
    this.deps.logger.warn('Desktop authentication operation failed', {
      operation,
      error: safeLogErrorDetails(error),
    });
  }
}
