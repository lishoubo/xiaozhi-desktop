/**
 * 带认证的 rms-server 请求出口。
 *
 * 签名就是标准 `fetch`，所以 gateway 拿到它跟用普通 fetch 没有区别——
 * 只写业务请求，不碰 token：
 *
 *   const response = await this.fetch(`${origin}/api/v1/app/hotels`);
 *
 * 这一层负责的事，gateway 一行都不用写：
 *   - 注入 `Authorization: Bearer <token>`（过期的话 provider 会先刷新）
 *   - 注入 ASCII User-Agent（rms-server 的 StrictHttpFirewall 拒收非 ASCII 头值，
 *     而 Electron 默认 UA 带中文应用名）
 *   - 服务端拒绝当前 token 时，作废缓存并**重试一次**
 *
 * 只重试一次：第二次仍被拒说明不是"本地缓存陈旧"，而是登录态确实结束了，
 * 继续重试只会放大失败。此时原样返回 401，由调用方决定是否引导重新登录——
 * 认证层不擅自清登录态。
 */
import type { AppLogger } from '../../shared/logging';
import { randomUUID } from 'node:crypto';
import type { RmsTokenProvider } from './rms-token-provider';
import { executeLoggedRmsFetch } from './rms-http-logging';

/**
 * 覆盖 Electron 的默认 UA：默认值里带着中文应用名（"小智酒店管家"），会被
 * rms-server 的 `StrictHttpFirewall` 在进 controller 之前拒掉。
 */
const RMS_USER_AGENT = 'XiaozhiHotelButler/1.0.0 (Electron)';

export type AuthenticatedRmsFetchDependencies = Readonly<{
  /** 底层传输，通常是 `createElectronSessionFetch(rmsSession)`。 */
  fetch: typeof globalThis.fetch;
  provider: RmsTokenProvider;
  logger: AppLogger;
  now?: () => number;
  requestIdFactory?: () => string;
}>;

export function createAuthenticatedRmsFetch(
  deps: AuthenticatedRmsFetchDependencies,
): typeof globalThis.fetch {
  const { fetch, provider, logger } = deps;
  const now = deps.now ?? (() => performance.now());
  const requestIdFactory = deps.requestIdFactory ?? randomUUID;

  const send = async (
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    accessToken: string,
    requestId: string,
    attempt: number,
  ): Promise<Response> => {
    const headers = new Headers(init?.headers);
    headers.set('authorization', `Bearer ${accessToken}`);
    headers.set('user-agent', RMS_USER_AGENT);
    if (!headers.has('accept')) headers.set('accept', 'application/json');

    return executeLoggedRmsFetch({
      attempt,
      fetch,
      input,
      init: { ...init, headers },
      logger,
      now,
      operation: 'authenticated_fetch',
      requestId,
    });
  };

  return async (input, init) => {
    const requestId = requestIdFactory();
    const response = await send(input, init, await provider.accessToken(), requestId, 1);
    if (response.status !== 401) return response;

    // 401 只说明服务端不认这个 token。本地缓存可能已经陈旧（换了机器、
    // 服务端重启清了会话），丢掉重取一次是有意义的；再失败就不是缓存问题。
    logger.warn('RMS rejected the access token; retrying once with a fresh one');
    provider.invalidate();
    return send(input, init, await provider.accessToken(), requestId, 2);
  };
}
