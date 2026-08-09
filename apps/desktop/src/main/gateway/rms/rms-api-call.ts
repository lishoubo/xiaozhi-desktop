/**
 * rms-server `ApiResponse<T>` 的拆包器，供各 gateway 共用。
 *
 * 认证不在这里——注入 Bearer、过期刷新、401 重试都由传入的 `fetch`
 * （`createAuthenticatedRmsFetch` 的产物）负责。这一层只管：拼请求、拆包装、
 * 把业务失败转成带远端文案的错误。
 */
import { z } from 'zod';
import type { AppLogger } from '../../../shared/logging';

/**
 * `data` 用 `optional`：错误响应（`ApiResponse.error`）不带这个字段，若要求必填，
 * 远端的具体失败原因会被兜底文案吞掉。
 */
const envelopeSchema = z.object({
  code: z.number(),
  message: z.string().optional(),
  data: z.unknown().optional(),
});

export type RmsApiCallerDependencies = Readonly<{
  origin: string;
  /** 已带认证的 fetch —— 见 `createAuthenticatedRmsFetch`。 */
  fetch: typeof globalThis.fetch;
  logger: AppLogger;
  /** 出现在日志与兜底文案里，例如「酒店服务」。 */
  subject: string;
}>;

export type RmsApiCall = (
  operation: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
) => Promise<unknown>;

export function createRmsApiCall(deps: RmsApiCallerDependencies): RmsApiCall {
  const { origin, fetch, logger, subject } = deps;

  return async (operation, method, path, body) => {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (cause) {
      logger.warn('RMS response was not valid JSON', {
        operation,
        subject,
        status: response.status,
      });
      throw new Error(`${subject}返回异常，请稍后重试`, { cause });
    }

    const envelope = envelopeSchema.safeParse(payload);
    if (!envelope.success) {
      // 非 ApiResponse 形状：多半是 Spring 默认 error 页，或反向代理插进来的错误。
      logger.warn('RMS response had an unexpected shape', {
        operation,
        subject,
        status: response.status,
      });
      throw new Error(`${subject}返回异常，请稍后重试`, { cause: envelope.error });
    }

    if (envelope.data.code !== 0) {
      logger.warn('RMS rejected the request', {
        operation,
        subject,
        rmsCode: envelope.data.code,
      });
      // 远端 message 已是面向人的文案，直接透传比在这里重编一套更准确。
      throw new Error(envelope.data.message ?? `${subject}操作失败，请稍后重试`);
    }

    return envelope.data.data;
  };
}
