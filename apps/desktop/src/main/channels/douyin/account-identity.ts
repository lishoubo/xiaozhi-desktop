import { z } from 'zod';
import type { JsonObject } from '../../../shared/types/json';

const stringLikeSchema = z.union([z.string(), z.number()]);
const numberLikeSchema = z.union([z.number(), z.string()]);

/**
 * 身份的**必需**部分只有三项：`user_id`（渠道账号标识）、`login_id`、`name`。
 *
 * ⚠️ `role_name` / `role_type` 是**可选**的，因为它们是**门店级**属性，而抖音的
 * 连锁/集团账号没有门店角色 —— 2026-09-01 真机实测，集团账号
 * （`groupid=1740676251868171`，下挂多家门店）的 `login_info` 返回
 * `role_name: null, role_type: null`，其余三项正常。
 *
 * 当初把这两项设为必需，等于**把所有连锁账号挡在门外**：身份建不出来 → 没有
 * credential → 酒店探测（`hotel-prob.ts`）永远不会被调用，用户看到的现象是
 * 「登录成功了但绑定流程没有继续」。它们只进 `credentialExtra` 供展示，既不参与
 * 身份标识（那是 `user_id`），也不参与账号显示名（`channelAccountNameOf` 取的是
 * `name`），因此缺失不该阻断任何事。
 */
const douyinAccountIdentitySchema = z.object({
  user_id: stringLikeSchema,
  login_id: stringLikeSchema,
  name: z.string(),
  role_name: z.string().nullish(),
  role_type: numberLikeSchema.nullish(),
});

export type DouyinCredentialIdentity = Readonly<{
  channelAccountId: string;
  credentialExtra: JsonObject;
}>;

function nullableString(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function nullableNumber(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null;
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

export function parseDouyinAccountIdentity(raw: unknown): DouyinCredentialIdentity | null {
  const parsed = douyinAccountIdentitySchema.safeParse(raw);
  if (!parsed.success) return null;

  const channelAccountId = nullableString(parsed.data.user_id);
  const loginId = nullableString(parsed.data.login_id);
  const name = parsed.data.name.trim();
  const roleName = nullableString(parsed.data.role_name);
  const roleType = nullableNumber(parsed.data.role_type);
  if (!channelAccountId || !loginId || !name) return null;

  // 角色缺失时**省略这两个键**而不是写 null —— 与 `bind-extra.ts` 的既有约定一致：
  // 写了 null，下次读取就分不清「没有这个字段」和「这个字段是空的」。
  return {
    channelAccountId,
    credentialExtra: {
      loginId,
      name,
      ...(roleName === null ? {} : { roleName }),
      ...(roleType === null ? {} : { roleType }),
    },
  };
}

export const READ_DOUYIN_ACCOUNT_IDENTITY_EXPRESSION = `
  (async () => {
    try {
      const parseStoredValue = (value) => {
        let parsed = value;
        for (let depth = 0; depth < 3 && typeof parsed === 'string'; depth += 1) {
          parsed = JSON.parse(parsed);
        }
        return parsed;
      };

      const groupId = new URL(location.href).searchParams.get('groupid');
      const storage = parseStoredValue(sessionStorage.getItem('PartnerPrefetchStorage'));
      const accountDetail = parseStoredValue(storage?.getAccountDetail);
      const accountData = parseStoredValue(accountDetail?.data);
      const accountId = String(accountData?.account_id ?? '').trim();
      if (!groupId || !accountId) return null;

      const query = new URLSearchParams({ groupId, accountId });
      const response = await fetch('/life/gate/v1/user/login_info/?' + query.toString(), {
        method: 'GET',
        credentials: 'include',
        headers: { accept: 'application/json, text/plain, */*' },
      });
      if (!response.ok) return null;
      const body = await response.json();
      const data = body && typeof body === 'object' ? body.data : null;
      if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
      return {
        user_id: data.user_id ?? null,
        login_id: data.login_id ?? null,
        name: data.name ?? null,
        role_name: data.role_name ?? null,
        role_type: data.role_type ?? null,
      };
    } catch (error) {
      return null;
    }
  })()
`;
