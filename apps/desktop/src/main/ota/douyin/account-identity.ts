import { z } from 'zod';
import type { JsonObject } from '../../../domain/json';

const stringLikeSchema = z.union([z.string(), z.number()]);
const numberLikeSchema = z.union([z.number(), z.string()]);

const douyinAccountIdentitySchema = z.object({
  user_id: stringLikeSchema,
  login_id: stringLikeSchema,
  name: z.string(),
  role_name: z.string(),
  role_type: numberLikeSchema,
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
  const roleName = parsed.data.role_name.trim();
  const roleType = nullableNumber(parsed.data.role_type);
  if (!channelAccountId || !loginId || !name || !roleName || roleType === null) return null;

  return {
    channelAccountId,
    credentialExtra: {
      loginId,
      name,
      roleName,
      roleType,
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
