/**
 * RMS access token 的唯一出口。
 *
 * 存在的理由：业务 gateway 要带 token 调 rms-server，但「读盘 → 判过期 → 刷新 →
 * 落盘」这套判断不能在每个 gateway 里重写一遍——重写就意味着并发去重失效，
 * 多个 gateway 同时发现 token 过期会各刷一次。
 *
 * 与 `StaffAuthService` 的分工：
 *   - 本模块只管「给我一个能用的 access token」，不碰登录态
 *   - 登录 / 登出 / 取身份仍归 `StaffAuthService`，它也从这里取 token
 *
 * 刻意**不在刷新失败时清本地凭证**：认证层只负责报错，登出与否是调用方的决定。
 * 否则一次后台请求撞上过期，会静默把用户踢下线。
 */
import type { AppLogger } from '../../shared/logging';
import type { RmsAuthClient, RmsTokenPair } from './rms-auth-client';
import { RmsSessionMissingError } from './rms-session-missing-error';
import type { StaffTokenStore, StoredStaffTokens } from './token-store';
export { RmsSessionMissingError } from './rms-session-missing-error';

/**
 * 判断 access 是否过期时预留的余量：卡在过期点上发出的请求，到达服务端时可能
 * 刚好越线，白白浪费一次往返。
 */
const EXPIRY_SKEW_MS = 30_000;

export interface RmsTokenProvider {
  /** 取一个当前可用的 access token，必要时先刷新。无有效会话时抛错。 */
  accessToken(): Promise<string>;
  /** 丢弃内存缓存，下次重新读盘。服务端已拒绝当前 token 时调用。 */
  invalidate(): void;
  /** 登录成功后把新 token 交给本模块，省掉一次多余的读盘。 */
  adopt(pair: RmsTokenPair): Promise<void>;
  /** 登出时清空——本地凭证与内存缓存一起。 */
  clear(): Promise<void>;
}

export type RmsTokenProviderDependencies = Readonly<{
  tokenStore: StaffTokenStore;
  client: Pick<RmsAuthClient, 'refresh'>;
  now: () => number;
  logger: AppLogger;
}>;

export function createRmsTokenProvider(deps: RmsTokenProviderDependencies): RmsTokenProvider {
  const { tokenStore, client, now, logger } = deps;

  /**
   * 内存里的当前凭证。省掉每次请求都读盘解密——`safeStorage` 的解密在 macOS 上
   * 会走钥匙串，不是免费的。
   */
  let cached: StoredStaffTokens | null = null;

  /**
   * 并发去重：多个 gateway 可能同时发现 token 过期。RMS 的 refresh 会作废旧
   * refresh token（单次使用），并发刷新会让后到的那次拿着已作废的凭证失败。
   *
   * 按 **refresh token 取值** 而非单纯持有一个 promise 来键控：后到的调用方可能
   * 在上一次刷新落地、`inFlightRefresh` 已清空之后才进来，手里却还攥着刷新前的
   * 凭证——那时若直接发出去，用的就是已被作废的 token。
   */
  let inFlight: Readonly<{ refreshToken: string; pending: Promise<StoredStaffTokens> }> | null =
    null;

  /** 服务端已明确拒绝当前 access token，下次取用前必须先换一个。 */
  let forceRefresh = false;

  const isExpired = (expiresAt: number): boolean => expiresAt - EXPIRY_SKEW_MS <= now();

  const toStored = (pair: RmsTokenPair): StoredStaffTokens => {
    const issuedAt = now();
    return {
      accessToken: pair.accessToken,
      refreshToken: pair.refreshToken,
      accessExpiresAt: issuedAt + pair.accessExpiresInSeconds * 1000,
      refreshExpiresAt: issuedAt + pair.refreshExpiresInSeconds * 1000,
    };
  };

  const persist = async (pair: RmsTokenPair): Promise<StoredStaffTokens> => {
    const stored = toStored(pair);
    cached = stored;
    await tokenStore.write(stored);
    return stored;
  };

  /**
   * 用指定的 refresh token 换一对新凭证。同一个 refresh token 只会真正发一次
   * 请求，后到者复用同一个 promise；若它已经被别人换掉，直接返回换出来的结果。
   */
  const refreshWith = (refreshToken: string): Promise<StoredStaffTokens> => {
    if (inFlight?.refreshToken === refreshToken) return inFlight.pending;
    if (cached && cached.refreshToken !== refreshToken) {
      // 手里这个已经被上一次刷新消费掉了，缓存里就是刷新后的结果。
      return Promise.resolve(cached);
    }

    const pending = client.refresh(refreshToken).then(persist);
    inFlight = { refreshToken, pending };
    return pending.finally(() => {
      if (inFlight?.refreshToken === refreshToken) inFlight = null;
    });
  };

  return {
    accessToken: async () => {
      const current = cached ?? (await tokenStore.read());
      if (!current) throw new RmsSessionMissingError();
      cached = current;

      const mustRefresh = forceRefresh || isExpired(current.accessExpiresAt);
      if (!mustRefresh) return current.accessToken;

      if (isExpired(current.refreshExpiresAt)) {
        // refresh 也过期了：再刷也是白发一次请求。这对凭证已经彻底没用，
        // 顺手清掉——留在盘上只会让之后每次调用都白读一次。
        logger.warn('RMS refresh token expired; a new sign-in is required');
        forceRefresh = false;
        cached = null;
        await tokenStore.clear();
        throw new RmsSessionMissingError();
      }

      const stored = await refreshWith(current.refreshToken);
      forceRefresh = false;
      return stored.accessToken;
    },

    /**
     * 服务端拒绝了当前 token。**不能只丢内存缓存**：盘上那份还没到期，会被原样
     * 读回来再发一次，重试必然又是 401。标记成"下次必须换新的"才有意义。
     */
    invalidate: () => {
      forceRefresh = true;
    },

    adopt: async (pair) => {
      // 刚登录换来的 token 一定是新鲜的，之前的"必须刷新"标记就此作废。
      forceRefresh = false;
      await persist(pair);
    },

    clear: async () => {
      forceRefresh = false;
      cached = null;
      await tokenStore.clear();
    },
  };
}
