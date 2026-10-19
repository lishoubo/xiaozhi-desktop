import { z } from 'zod';
import type { JsonObject } from '../../../shared/types/json';

const MEITUAN_SUCCESS_CODE = 10000;

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

const candidateIdsSchema = z.array(z.string());

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

export function parseMeituanCandidateIds(raw: unknown): readonly string[] {
  const parsed = candidateIdsSchema.safeParse(raw);
  if (!parsed.success) return [];
  return [...new Set(parsed.data.map((id) => id.trim()).filter(Boolean))];
}

/** Reads cached account clues only. No network calls execute in the page. */
export const READ_MEITUAN_ACCOUNT_CANDIDATES_EXPRESSION = `
  (() => {
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

      return readAccountIds();
    } catch (error) {
      return [];
    }
  })()
`;
