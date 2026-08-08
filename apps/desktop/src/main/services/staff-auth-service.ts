/**
 * 员工用户名/密码登录的编排层。
 *
 * 这一层存在的理由是"顺序"和"半截状态"：登录要先换 token 再取身份，取身份失败就
 * 必须把刚写下的 token 清掉；恢复会话要先判过期、再决定刷不刷；登出无论远端成败
 * 都得清本地。这些都不是 client 或 store 单独能承担的判断。
 */
import type { StaffIdentity } from '@hotel-butler/api';
import type { AppLogger } from '../../shared/logging';
import type { RmsAuthClient, RmsTokenPair } from '../staff-auth/rms-auth-client';
import {
  RmsAuthError,
  isAccessTokenRejected,
  messageForRmsError,
} from '../staff-auth/rms-auth-errors';
import type { StaffTokenStore, StoredStaffTokens } from '../staff-auth/token-store';

/**
 * 判断 access 是否过期时预留的余量：卡在过期点上发出的请求，到达服务端时可能
 * 刚好越线，白白浪费一次往返。
 */
const EXPIRY_SKEW_MS = 30_000;

export type StaffAuthServiceDependencies = Readonly<{
  client: RmsAuthClient;
  tokenStore: StaffTokenStore;
  now: () => number;
  logger: AppLogger;
}>;

export class StaffAuthService {
  /**
   * 并发去重：`currentSession` 可能被多处同时调用。RMS 的 refresh 不是单次使用
   * （只验签+查库，不作废旧 token），并发不会互相踢掉，但会白白刷出多对 token。
   */
  private inFlightRefresh: Promise<RmsTokenPair> | null = null;

  constructor(private readonly deps: StaffAuthServiceDependencies) {}

  async login(username: string, password: string): Promise<StaffIdentity> {
    const pair = await this.translate('login', '登录失败，请稍后重试', () =>
      this.deps.client.login(username, password),
    );
    await this.deps.tokenStore.write(this.toStoredTokens(pair));

    try {
      return await this.deps.client.me(pair.accessToken);
    } catch (error) {
      // 拿到 token 却取不到身份：不能让"有凭证、无身份"的半截状态留在盘上。
      await this.deps.tokenStore.clear();
      throw this.toUserFacingError('login-profile', '登录失败，请稍后重试', error);
    }
  }

  async currentSession(): Promise<StaffIdentity | null> {
    const stored = await this.deps.tokenStore.read();
    if (!stored) return null;

    if (!this.isExpired(stored.accessExpiresAt)) {
      try {
        return await this.deps.client.me(stored.accessToken);
      } catch (error) {
        // 只有"access 被拒"才值得刷新；其余错误（网络、服务端故障）如实抛出，
        // 否则会把一次临时故障误判成"登录已失效"，白白清掉用户的登录态。
        if (!(error instanceof RmsAuthError) || !isAccessTokenRejected(error.code)) {
          throw this.toUserFacingError('current-session', '无法验证登录状态，请重试', error);
        }
      }
    }

    return this.refreshAndLoadProfile(stored);
  }

  /**
   * 无论远端是否成功都要清本地：远端失败时若保留 token，用户会停在
   * "以为已登出、实际仍持有效凭证"的状态。
   */
  async logout(): Promise<{ success: true }> {
    try {
      const stored = await this.deps.tokenStore.read();
      if (stored) await this.deps.client.logout(stored.accessToken);
      return { success: true };
    } catch (error) {
      throw this.toUserFacingError('logout', '退出登录失败，请重试', error);
    } finally {
      await this.deps.tokenStore.clear();
    }
  }

  private async refreshAndLoadProfile(stored: StoredStaffTokens): Promise<StaffIdentity | null> {
    if (this.isExpired(stored.refreshExpiresAt)) {
      await this.deps.tokenStore.clear();
      return null;
    }

    let refreshed: RmsTokenPair;
    try {
      refreshed = await this.refreshOnce(stored.refreshToken);
    } catch (error) {
      if (error instanceof RmsAuthError) {
        // refresh 也被拒：登录态确实结束了，清干净并回登录页。
        await this.deps.tokenStore.clear();
        return null;
      }
      throw error;
    }

    await this.deps.tokenStore.write(this.toStoredTokens(refreshed));

    try {
      return await this.deps.client.me(refreshed.accessToken);
    } catch (error) {
      throw this.toUserFacingError('current-session', '无法验证登录状态，请重试', error);
    }
  }

  private refreshOnce(refreshToken: string): Promise<RmsTokenPair> {
    if (this.inFlightRefresh) return this.inFlightRefresh;

    const pending = this.deps.client.refresh(refreshToken);
    this.inFlightRefresh = pending;
    return pending.finally(() => {
      this.inFlightRefresh = null;
    });
  }

  private isExpired(expiresAt: number): boolean {
    return expiresAt - EXPIRY_SKEW_MS <= this.deps.now();
  }

  private toStoredTokens(pair: RmsTokenPair): StoredStaffTokens {
    const issuedAt = this.deps.now();
    return {
      accessToken: pair.accessToken,
      refreshToken: pair.refreshToken,
      accessExpiresAt: issuedAt + pair.accessExpiresInSeconds * 1000,
      refreshExpiresAt: issuedAt + pair.refreshExpiresInSeconds * 1000,
    };
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
