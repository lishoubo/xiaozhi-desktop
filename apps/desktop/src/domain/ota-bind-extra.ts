import type { JsonObject } from './json';

export function douyinBindExtra(merchantGroupId: string): JsonObject {
  return { merchantGroupId };
}

export function meituanBindExtra(
  otaPartnerId: string | null,
  otaPartnerName: string | null,
): JsonObject | null {
  if (otaPartnerId === null && otaPartnerName === null) return null;
  return { otaPartnerId, otaPartnerName };
}

export function merchantGroupIdFromBindExtra(bindExtra: JsonObject | null): string | null {
  if (bindExtra === null) return null;
  const value = bindExtra.merchantGroupId;
  return typeof value === 'string' && value.length > 0 ? value : null;
}
