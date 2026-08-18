/**
 * rms-server 认证接口的 HTTP 适配器。
 *
 * 只做三件事：拼请求、拆 `ApiResponse<T>` 包装、把失败转成 `RmsAuthError`。
 * 不碰 token 的存取，也不决定"失效了要不要刷新"——那是 service 的事。
 */
import {
  staffIdentitySchema,
  staffPhoneCodeRequestResponseSchema,
  type StaffIdentity,
  type StaffPhoneCodeRequestResponse,
  // eslint-disable-next-line import/no-unresolved -- ESLint's legacy resolver does not read this workspace package subpath export.
} from '@hotel-butler/api/contracts';
import { z } from 'zod';
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
  requestPhoneCode(phone: string): Promise<StaffPhoneCodeRequestResponse>;
  loginWithPhoneCode(phone: string, code: string): Promise<RmsTokenPair>;
  refresh(refreshToken: string): Promise<RmsTokenPair>;
  me(accessToken: string): Promise<StaffIdentity>;
  logout(accessToken: string): Promise<void>;
}

export type RmsAuthClientDependencies = Readonly<{
  origin: string;
  fetch: typeof globalThis.fetch;
  logger: AppLogger;
  /** 随请求上报的客户端版本（`X-App-Version`），由装配层从 `app.getVersion()` 注入。 */
  appVersion: string;
  /**
   * 随请求上报的设备标识（`X-Device-Id`），跨重启稳定，与登录用户无关。
   *
   * 传函数而非值：读它要碰磁盘，而 `createAppScope` 是同步的。做成惰性的以后，
   * 装配层不必为一个"不带也能登录"的头把整条启动路径改成异步。
   */
  deviceId: () => Promise<string>;
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

/**
 * 把 Zod 的校验失败压成"哪个字段、错在哪"的可记录形态。
 *
 * 只取 `path` / `code` / `message` 这类结构信息，**不取字段值**——这里校验的是身份
 * 与凭证响应，值里可能有手机号、姓名。没有这一层的话，日志只剩一句"契约不符"，
 * 定位得靠猜（真机联调时就因此多花了两轮才定位到 `currentHotelId` 缺失）。
 */
function describeSchemaIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    // `issue.message` 形如 "expected string, received undefined"，已含期望与实收类型，
    // 但不含字段值——正是这里要的粒度。
    return `${path}: ${issue.code} (${issue.message})`;
  });
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
    // 登录指纹头挂在所有认证请求上（不止短信接口）：服务端 `login_log` 按它归因，
    // 缺失时存 null 也能登录，所以这里不做任何校验或兜底。
    const headers: Record<string, string> = {
      accept: 'application/json',
      'user-agent': RMS_USER_AGENT,
      'x-app-version': deps.appVersion,
      'x-device-id': await deps.deviceId(),
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

  const requirePhoneCodeResponse = (
    operation: string,
    data: unknown,
  ): StaffPhoneCodeRequestResponse => {
    const parsed = staffPhoneCodeRequestResponseSchema.safeParse(data);
    if (!parsed.success) {
      // 两个时长字段缺一不可：少了 `resendAfterSeconds` 就无从决定按钮倒计时，
      // 用 `expiresInSeconds` 顶替会把 60s 的间隔算成 300s。
      logger.warn('RMS phone code response did not match the expected contract', {
        operation,
        issues: describeSchemaIssues(parsed.error),
      });
      throw new RmsAuthError(TRANSPORT_ERROR_CODE, '验证码发送失败，请稍后再试', {
        cause: parsed.error,
      });
    }
    return parsed.data;
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

    requestPhoneCode: async (phone) =>
      requirePhoneCodeResponse(
        'request-phone-code',
        await call({
          operation: 'request-phone-code',
          method: 'POST',
          path: '/api/v1/auth/sms/request-code',
          body: { phone },
        }),
      ),

    loginWithPhoneCode: async (phone, code) =>
      requireTokenPair(
        'login-phone',
        await call({
          operation: 'login-phone',
          method: 'POST',
          path: '/api/v1/auth/sms/login',
          body: { phone, code },
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
        logger.warn('RMS profile did not match the expected contract', {
          operation: 'me',
          issues: describeSchemaIssues(parsed.error),
        });
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
