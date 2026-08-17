/**
 * rms-server 认证接口的 HTTP 适配器。
 *
 * 只做三件事：拼请求、拆 `ApiResponse<T>` 包装、把失败转成 `RmsAuthError`。
 * 不碰 token 的存取，也不决定"失效了要不要刷新"——那是 service 的事。
 */
// eslint-disable-next-line import/no-unresolved -- ESLint's legacy resolver does not read this workspace package subpath export.
import { staffIdentitySchema, type StaffIdentity } from '@hotel-butler/api/contracts';
import type { AppLogger } from '../../shared/logging';
import { randomUUID } from 'node:crypto';
import { RmsAuthError } from './rms-auth-errors';
import { executeLoggedRmsFetch } from './rms-http-logging';

export type RmsTokenPair = Readonly<{
  accessToken: string;
  refreshToken: string;
  accessExpiresInSeconds: number;
  refreshExpiresInSeconds: number;
}>;

export interface RmsAuthClient {
  login(username: string, password: string): Promise<RmsTokenPair>;
  refresh(refreshToken: string): Promise<RmsTokenPair>;
  me(accessToken: string): Promise<StaffIdentity>;
  logout(accessToken: string): Promise<void>;
}

export type RmsAuthClientDependencies = Readonly<{
  origin: string;
  fetch: typeof globalThis.fetch;
  logger: AppLogger;
  now?: () => number;
  requestIdFactory?: () => string;
}>;

/** 非业务码：网络/解析/契约层面的失败，RMS 那边没有对应枚举。 */
const TRANSPORT_ERROR_CODE = -1;

/**
 * 覆盖 Electron 的默认 UA。
 *
 * 默认 UA 里带着中文应用名（"小智酒店管家"），而 rms-server 的
 * `StrictHttpFirewall` 只接受 ASCII header 值，会在请求进 controller 之前就
 * 拒掉它——表现为密码明明正确却返回 `INTERNAL_ERROR(10000)`。
 *
 * 只在这里覆盖，不动 `SessionFactory`：那份 session 的 cookie jar 还要服务
 * 别的用途，OTA 浏览态更依赖真实浏览器 UA，不能被这个约束波及。
 */
const RMS_USER_AGENT = 'XiaozhiHotelButler/1.0.0 (Electron)';

type ApiEnvelope = Readonly<{ code: number; message: string; data: unknown }>;

type RequestSpec = Readonly<{
  operation: string;
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  accessToken?: string;
}>;

function isApiEnvelope(value: unknown): value is ApiEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof (value as { code: unknown }).code === 'number'
  );
}

function isTokenPair(value: unknown): value is RmsTokenPair {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.accessToken === 'string' &&
    typeof candidate.refreshToken === 'string' &&
    typeof candidate.accessExpiresInSeconds === 'number' &&
    typeof candidate.refreshExpiresInSeconds === 'number'
  );
}

export function createRmsAuthClient(deps: RmsAuthClientDependencies): RmsAuthClient {
  const { origin, fetch, logger } = deps;
  const now = deps.now ?? (() => performance.now());
  const requestIdFactory = deps.requestIdFactory ?? randomUUID;

  /**
   * 发一次请求并拆包。所有失败路径都收敛成 `RmsAuthError`，调用方只看 `code`，
   * 不必区分是传输层还是业务层出的错。
   *
   * 日志只记操作名与业务码——用户名、密码、token 一律不出现。
   */
  const call = async (spec: RequestSpec): Promise<unknown> => {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'user-agent': RMS_USER_AGENT,
    };
    if (spec.body !== undefined) headers['content-type'] = 'application/json';
    if (spec.accessToken) headers.authorization = `Bearer ${spec.accessToken}`;

    let response: Response;
    try {
      response = await executeLoggedRmsFetch({
        attempt: 1,
        fetch,
        input: `${origin}${spec.path}`,
        init: {
          method: spec.method,
          headers,
          body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
        },
        logger,
        now,
        operation: spec.operation,
        requestId: requestIdFactory(),
      });
    } catch (cause) {
      // 连不上 / DNS / TLS——没有业务码可用。
      logger.warn('RMS authentication request failed to reach the server', {
        operation: spec.operation,
      });
      throw new RmsAuthError(TRANSPORT_ERROR_CODE, '登录服务暂时不可用，请稍后重试', { cause });
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (cause) {
      logger.warn('RMS authentication response was not valid JSON', {
        operation: spec.operation,
        status: response.status,
      });
      throw new RmsAuthError(TRANSPORT_ERROR_CODE, '登录服务返回异常，请稍后重试', { cause });
    }

    if (!isApiEnvelope(payload)) {
      // 非 ApiResponse 形状：多半是 Spring 默认 error 页，或反向代理插进来的错误。
      logger.warn('RMS authentication response had an unexpected shape', {
        operation: spec.operation,
        status: response.status,
      });
      throw new RmsAuthError(TRANSPORT_ERROR_CODE, '登录服务返回异常，请稍后重试');
    }

    if (payload.code !== 0) {
      logger.warn('RMS authentication rejected the request', {
        operation: spec.operation,
        rmsCode: payload.code,
      });
      throw new RmsAuthError(payload.code, payload.message);
    }

    return payload.data;
  };

  const requireTokenPair = (operation: string, data: unknown): RmsTokenPair => {
    if (!isTokenPair(data)) {
      logger.warn('RMS token response was missing required fields', { operation });
      throw new RmsAuthError(TRANSPORT_ERROR_CODE, '登录服务返回异常，请稍后重试');
    }
    return data;
  };

  return {
    login: async (username, password) =>
      requireTokenPair(
        'login',
        await call({
          operation: 'login',
          method: 'POST',
          path: '/api/v1/auth/login',
          body: { username, password },
        }),
      ),

    refresh: async (refreshToken) =>
      requireTokenPair(
        'refresh',
        await call({
          operation: 'refresh',
          method: 'POST',
          path: '/api/v1/auth/refresh',
          body: { refreshToken },
        }),
      ),

    me: async (accessToken) => {
      const data = await call({
        operation: 'me',
        method: 'GET',
        path: '/api/v1/me',
        accessToken,
      });

      const parsed = staffIdentitySchema.safeParse(data);
      if (!parsed.success) {
        // 契约漂移要显式暴露，不能让半个身份对象流进业务层。
        logger.warn('RMS profile did not match the expected contract', { operation: 'me' });
        throw new RmsAuthError(TRANSPORT_ERROR_CODE, '登录服务返回异常，请稍后重试', {
          cause: parsed.error,
        });
      }
      return parsed.data;
    },

    logout: async (accessToken) => {
      await call({
        operation: 'logout',
        method: 'POST',
        path: '/api/v1/auth/logout',
        accessToken,
      });
    },
  };
}
