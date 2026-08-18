/**
 * 员工用户名/密码登录的编排层。
 *
 * 这一层存在的理由是"顺序"和"半截状态"：登录要先换 token 再取身份，取身份失败就
 * 必须把刚写下的 token 清掉；恢复会话要先判过期、再决定刷不刷；登出无论远端成败
 * 都得清本地。这些都不是 client 或 store 单独能承担的判断。
 */
import type { StaffIdentity, StaffPhoneCodeRequestResponse } from '@hotel-butler/api';
import type { AppLogger } from '../../shared/logging';
import type { RmsAuthClient } from '../staff-auth/rms-auth-client';
import {
  RmsAuthError,
  isAccessTokenRejected,
  messageForRmsError,
} from '../staff-auth/rms-auth-errors';
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
   * 发验证码。没有顺序也没有半截状态可管，这里只做一件事：把远端错误转成可读文案。
   *
   * 不校验手机号格式——那是 IPC 边界的职责（`phoneNumberSchema`），
   * 这一层重复一遍只会让两处规则各自漂移。
   */
  async requestPhoneCode(phone: string): Promise<StaffPhoneCodeRequestResponse> {
    return this.translate('request-phone-code', '验证码发送失败，请稍后再试', () =>
      this.deps.client.requestPhoneCode(phone),
    );
  }

  /**
   * 验证码登录。与 `login()` 是同一段编排——短信登录返回的 token 对与密码登录
   * 同形状，所以"换 token → 存 → 取身份"三步以及失败清理完全一致。
   */
  async loginWithPhoneCode(phone: string, code: string): Promise<StaffIdentity> {
    const pair = await this.translate('login-phone', '登录失败，请稍后重试', () =>
      this.deps.client.loginWithPhoneCode(phone, code),
    );
    await this.deps.tokens.adopt(pair);

    try {
      return await this.deps.client.me(pair.accessToken);
    } catch (error) {
      // 同 `login()`：拿到 token 却取不到身份，不能留"有凭证、无身份"的半截状态。
      await this.deps.tokens.clear();
      throw this.toUserFacingError('login-phone-profile', '登录失败，请稍后重试', error);
    }
  }

  /**
   * 恢复会话。取 token 的过程（判过期、必要时刷新）已经收在 provider 里，
   * 这里负责的是另一件事：**服务端不认这个 token 时再换一个试一次**。
   *
   * 为什么需要重试——本地算出的 `accessExpiresAt` 只是 `issuedAt + TTL`，与服务端
   * 并不同步：时钟偏移、服务端主动吊销或轮换，都会让一个"本地看着还没过期"的
   * token 被拒。此时盘上的 refresh token 往往仍然可用，直接放弃等于每次开机都
   * 让用户重新输一遍账号密码。
   */
  async currentSession(): Promise<StaffIdentity | null> {
    try {
      return await this.loadProfile();
    } catch (error) {
      if (error instanceof RmsSessionMissingError) return null;
      if (!(error instanceof RmsAuthError)) {
        // 网络抖动之类的临时故障：如实抛出。误判成"登录失效"会白白清掉一个
        // 有效的登录态。
        throw this.toUserFacingError('current-session', '无法验证登录状态，请重试', error);
      }
      if (!isAccessTokenRejected(error.code)) {
        await this.deps.tokens.clear();
        return null;
      }
    }

    // access token 被拒——换一个再试一次。
    this.deps.tokens.invalidate();
    try {
      return await this.loadProfile();
    } catch (error) {
      // 换过 token 仍被拒：登录态确实结束了，清干净并回登录页。
      if (error instanceof RmsSessionMissingError || error instanceof RmsAuthError) {
        await this.deps.tokens.clear();
        return null;
      }
      throw this.toUserFacingError('current-session', '无法验证登录状态，请重试', error);
    }
  }

  private async loadProfile(): Promise<StaffIdentity> {
    return this.deps.client.me(await this.deps.tokens.accessToken());
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
