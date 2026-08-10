/**
 * `RmsOtaAccountGateway` 的真实实现——直连 rms-server 的 `/api/v1/app/ota-accounts`。
 *
 * 与 `HttpRmsHotelGateway` 一样，这里**没有一行 token 相关代码**：注入 Bearer、
 * 过期刷新、401 重试都由构造时传入的 `fetch` 负责。
 */
import { z } from 'zod';
import { toChannelId } from '../../ids';
import type { JsonObject, JsonValue } from '../../../shared/types/json';
import { createRmsOtaAccount, type RmsOtaAccount } from '../../../shared/types/rms-ota-account';
import { createRmsApiCall, type RmsApiCall, type RmsApiCallerDependencies } from './rms-api-call';
import type {
  RmsOtaAccountBindInput,
  RmsOtaAccountGateway,
  RmsOtaAccountReauthInput,
} from './types';

/**
 * `bindExtra` 是开放形状（远端会随渠道增删字段），所以按 JSON 递归校验而非逐字段
 * 列举——既保住 `JsonObject` 的类型保证，又不会因为远端多吐一个键就整条解析失败。
 */
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const jsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), jsonValueSchema);

/**
 * 对齐 rms-server 的 `AppOtaAccountResponse`。
 *
 * 可空字段一律 `.nullish()` 再归一成 `null`：远端对未初始化的绑定是**整个省略**
 * 这些键（不是给 null），而 desktop 的 `RmsOtaAccount` 要求 `string | null`。
 */
const otaAccountSchema = z.object({
  id: z.number().int().positive(),
  hotelId: z.number().int().positive(),
  otaHotelId: z.string().nullish(),
  otaHotelName: z.string().nullish(),
  status: z.string().min(1),
  source: z.string().min(1),
  bindExtra: jsonObjectSchema.nullish(),
});

function toRmsOtaAccount(raw: z.infer<typeof otaAccountSchema>): RmsOtaAccount {
  return createRmsOtaAccount({
    id: raw.id,
    hotelId: raw.hotelId,
    otaHotelId: raw.otaHotelId ?? null,
    otaHotelName: raw.otaHotelName ?? null,
    status: raw.status,
    source: toChannelId(raw.source),
    bindExtra: raw.bindExtra ?? null,
  });
}

export type HttpRmsOtaAccountGatewayDependencies = Omit<RmsApiCallerDependencies, 'subject'>;

export class HttpRmsOtaAccountGateway implements RmsOtaAccountGateway {
  private readonly call: RmsApiCall;

  constructor(deps: HttpRmsOtaAccountGatewayDependencies) {
    this.call = createRmsApiCall({ ...deps, subject: 'OTA 绑定服务' });
  }

  async listOtaAccounts(): Promise<readonly RmsOtaAccount[]> {
    const data = await this.call('listOtaAccounts', 'GET', '/api/v1/app/ota-accounts');
    return z.array(otaAccountSchema).parse(data).map(toRmsOtaAccount);
  }

  async bind(input: RmsOtaAccountBindInput): Promise<RmsOtaAccount> {
    const data = await this.call('bind', 'POST', '/api/v1/app/ota-accounts', {
      operationId: input.operationId,
      hotelId: input.hotelId,
      source: input.source,
      otaHotelId: input.otaHotelId,
      otaHotelName: input.otaHotelName,
      bindExtra: input.bindExtra,
      cookies: input.cookies,
    });
    return toRmsOtaAccount(otaAccountSchema.parse(data));
  }

  /**
   * 重新登录只换凭证，**不动门店关系**——所以请求体里没有 `hotelId` / `otaHotelId`。
   * 远端语义是「重新绑定」：会顺带把 bindSource 盖成 DESKTOP，并把同一登录凭据下
   * 其余酒店的 cookie 一并更新。
   *
   * `bindExtra` 是**整体替换**而非合并，所以传的必须是合并好的整份上下文；为 null
   * 时整个省略该键，让远端保持原值。
   */
  async reauthenticate(input: RmsOtaAccountReauthInput): Promise<RmsOtaAccount> {
    const data = await this.call(
      'reauthenticate',
      'PUT',
      `/api/v1/app/ota-accounts/${input.otaAccountId}`,
      {
        operationId: input.operationId,
        cookies: input.cookies,
        ...(input.bindExtra === null ? {} : { bindExtra: input.bindExtra }),
      },
    );
    return toRmsOtaAccount(otaAccountSchema.parse(data));
  }

  async unbind(otaAccountId: number): Promise<void> {
    await this.call('unbind', 'DELETE', `/api/v1/app/ota-accounts/${otaAccountId}`);
  }
}
