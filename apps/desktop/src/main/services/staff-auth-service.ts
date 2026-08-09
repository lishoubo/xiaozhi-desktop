/**
 * 员工用户名/密码登录的编排层。
 *
 * 这一层存在的理由是"顺序"和"半截状态"：登录要先换 token 再取身份，取身份失败就
 * 必须把刚写下的 token 清掉；恢复会话要先判过期、再决定刷不刷；登出无论远端成败
 * 都得清本地。这些都不是 client 或 store 单独能承担的判断。
 */
import type { StaffIdentity } from '@hotel-butler/api';
import type { AppLogger } from '../../shared/logging';
import type { RmsAuthClient } from '../staff-auth/rms-auth-client';
import { RmsAuthError, messageForRmsError } from '../staff-auth/rms-auth-errors';
import { RmsSessionMissingError, type RmsTokenProvider } from '../staff-auth/rms-token-provider';

export type StaffAuthServiceDependencies = Readonly<{
  client: RmsAuthClient;
  /** token 的读写、过期判断与刷新都归它，本服务不再自己维护一份。 */
  tokens: RmsTokenProvider;
  logger: AppLogger;
}>;

export class StaffAuthService {
  constructor(private readonly deps: StaffAuthServiceDependencies) {}

  async login(username: string, password: string): Promise<StaffIdentity> {
    const pair = await this.translate('login', '登录失败，请稍后重试', () =>
      this.deps.client.login(username, password),
    );
    await this.deps.tokens.adopt(pair);

    try {
      return await this.deps.client.me(pair.accessToken);
    } catch (error) {
      // 拿到 token 却取不到身份：不能让"有凭证、无身份"的半截状态留在盘上。
      await this.deps.tokens.clear();
      throw this.toUserFacingError('login-profile', '登录失败，请稍后重试', error);
    }
  }

  /**
   * 恢复会话。取 token 的过程（判过期、必要时刷新）已经收在 provider 里，
   * 这里只需要区分"确实没登录"和"临时故障"两种失败。
   */
  async currentSession(): Promise<StaffIdentity | null> {
    let accessToken: string;
    try {
      accessToken = await this.deps.tokens.accessToken();
    } catch (error) {
      if (error instanceof RmsSessionMissingError) return null;
      // refresh 被服务端拒绝：登录态确实结束了，清干净并回登录页。
      if (error instanceof RmsAuthError) {
        await this.deps.tokens.clear();
        return null;
      }
      throw this.toUserFacingError('current-session', '无法验证登录状态，请重试', error);
    }

    try {
      return await this.deps.client.me(accessToken);
    } catch (error) {
      throw this.toUserFacingError('current-session', '无法验证登录状态，请重试', error);
    }
  }

  /**
   * 无论远端是否成功都要清本地：远端失败时若保留 token，用户会停在
   * "以为已登出、实际仍持有效凭证"的状态。
   */
  async logout(): Promise<{ success: true }> {
    try {
      // 已经登出（或从未登录）时 provider 会抛 RmsSessionMissingError——
      // 本地清理仍要执行，所以放过这个错，其余照常上报。
      const accessToken = await this.deps.tokens.accessToken().catch((error: unknown) => {
        if (error instanceof RmsSessionMissingError) return null;
        throw error;
      });
      if (accessToken) await this.deps.client.logout(accessToken);
      return { success: true };
    } catch (error) {
      throw this.toUserFacingError('logout', '退出登录失败，请重试', error);
    } finally {
      await this.deps.tokens.clear();
    }
  }

  private async translate<T>(
    operation: string,
    fallback: string,
    call: () => Promise<T>,
  ): Promise<T> {
    try {
      return await call();
    } catch (error) {
      throw this.toUserFacingError(operation, fallback, error);
    }
  }

  /**
   * 把远端错误转成用户可读文案。刻意保留 `cause`，也刻意按错误码区分文案——
   * "账号已被锁定"和"用户名或密码错误"对用户是完全不同的行动指引。
   */
  private toUserFacingError(operation: string, fallback: string, error: unknown): Error {
    if (error instanceof RmsAuthError) {
      this.deps.logger.warn('Staff authentication operation failed', {
        operation,
        rmsCode: error.code,
      });
      return new Error(messageForRmsError(error.code, fallback), { cause: error });
    }

    this.deps.logger.warn('Staff authentication operation failed', {
      operation,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return new Error(fallback, { cause: error });
  }
}
