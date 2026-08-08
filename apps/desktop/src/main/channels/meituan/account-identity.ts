import { z } from 'zod';
import type { JsonObject } from '../../../shared/types/json';

const MEITUAN_SUCCESS_CODE = 10000;
const ME_API_APPKEY = 'fe_com.sankuai.fetalos.web.hotelfeme';
const ME_API_LOGIN_TYPE = 'Epassport';

const stringLikeSchema = z.union([z.string(), z.number()]);
const optionalStringLikeSchema = stringLikeSchema.nullish();
const optionalNumberSchema = z.number().nullish();

const accountDetailResponseSchema = z.object({
  code: stringLikeSchema,
  data: z
    .object({
      bizAcctId: stringLikeSchema,
      partnerId: optionalStringLikeSchema,
      login: z.string().nullish(),
      accountType: optionalNumberSchema,
      status: optionalNumberSchema,
      maskPhone: z.string().nullish(),
    })
    .optional(),
});

const accountIdentityCandidatesSchema = z.object({
  kind: z.literal('completed'),
  candidates: z.array(
    z.object({
      candidateAccountId: z.string(),
      response: z.unknown(),
    }),
  ),
});

export type MeituanCredentialIdentity = Readonly<{
  channelAccountId: string;
  credentialExtra: JsonObject;
}>;

function nullableString(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

export function parseMeituanAccountDetail(
  candidateAccountId: string,
  raw: unknown,
): MeituanCredentialIdentity | null {
  const candidate = candidateAccountId.trim();
  if (candidate.length === 0) return null;
  const parsed = accountDetailResponseSchema.safeParse(raw);
  if (!parsed.success || String(parsed.data.code) !== String(MEITUAN_SUCCESS_CODE)) return null;
  const account = parsed.data.data;
  if (!account) return null;
  const channelAccountId = String(account.bizAcctId).trim();
  if (channelAccountId.length === 0 || channelAccountId !== candidate) return null;

  return {
    channelAccountId,
    credentialExtra: {
      partnerId: nullableString(account.partnerId),
      login: account.login?.trim() || null,
      accountType: account.accountType ?? null,
      accountStatus: account.status ?? null,
      maskedPhone: account.maskPhone?.trim() || null,
    },
  };
}

export function parseMeituanAccountIdentityCandidates(
  raw: unknown,
): MeituanCredentialIdentity | null {
  const parsed = accountIdentityCandidatesSchema.safeParse(raw);
  if (!parsed.success) return null;
  for (const candidate of parsed.data.candidates) {
    const identity = parseMeituanAccountDetail(candidate.candidateAccountId, candidate.response);
    if (identity) return identity;
  }
  return null;
}

export const FETCH_MEITUAN_ACCOUNT_IDENTITY_EXPRESSION = `
  (async () => {
    try {
      const marker = 'req:announcementEB,key:';
      const readAccountIds = () => {
        const rawStorage = localStorage.getItem('globalStorage');
        if (!rawStorage) return [];
        let storage;
        try {
          storage = JSON.parse(rawStorage);
        } catch (error) {
          return [];
        }

        const matchingKeys = [];
        const visit = (value) => {
          if (typeof value === 'string') {
            if (value.includes(marker)) matchingKeys.push(value);
            return;
          }
          if (Array.isArray(value)) {
            value.forEach(visit);
            return;
          }
          if (value && typeof value === 'object') {
            for (const [key, nested] of Object.entries(value)) {
              visit(key);
              visit(nested);
            }
          }
        };
        visit(storage);

        const accountIds = [];
        const seen = new Set();
        for (const key of matchingKeys) {
          const markerIndex = key.indexOf(marker);
          try {
            const params = JSON.parse(key.slice(markerIndex + marker.length));
            const accountId = String(params.bizAccountId ?? '').trim();
            if (accountId && !seen.has(accountId)) {
              seen.add(accountId);
              accountIds.push(accountId);
            }
          } catch (error) {
            // Ignore malformed cache entries and continue with other candidates.
          }
        }
        return accountIds;
      };

      let accountIds = [];
      for (let attempt = 0; attempt < 20 && accountIds.length === 0; attempt += 1) {
        accountIds = readAccountIds();
        if (accountIds.length === 0) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      if (accountIds.length === 0) return { kind: 'missing-account-candidate' };

      const candidates = [];
      for (const candidateAccountId of accountIds) {
        const query = new URLSearchParams({
          beQueriedAccountId: candidateAccountId,
          doQueryAccountId: candidateAccountId,
        });
        const response = await new Promise((resolve) => {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', '/api/gw/v1/base/account/getDetail?' + query.toString(), true);
          xhr.withCredentials = true;
          xhr.setRequestHeader('Accept', 'application/json');
          xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
          xhr.setRequestHeader('M-APPKEY', ${JSON.stringify(ME_API_APPKEY)});
          xhr.setRequestHeader('locale', 'zh-CN');
          xhr.setRequestHeader('logintype', ${JSON.stringify(ME_API_LOGIN_TYPE)});
          xhr.onload = () => {
            try {
              resolve(JSON.parse(xhr.responseText));
            } catch (error) {
              resolve(null);
            }
          };
          xhr.onerror = () => resolve(null);
          xhr.send(null);
        });
        candidates.push({ candidateAccountId, response });
      }
      return { kind: 'completed', candidates };
    } catch (error) {
      return { kind: 'failed' };
    }
  })()
`;
