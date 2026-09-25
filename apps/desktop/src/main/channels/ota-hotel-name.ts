import type { JsonObject } from '../../shared/types/json';
import { MEITUAN_POIS_FIELD } from './meituan/poi-infos';

/**
 * 从凭证里取**这家门店**的名字 —— 只按已知的 `otaHotelId` 精确匹配，取不到返回 null。
 *
 * ```
 * ctrip    credentialExtra.hotelName      仅当 masterHotelId === otaHotelId
 * meituan  credentialExtra.pois[].poiName  poiId === otaHotelId 的那一条
 * 其余     null（抖音凭证里没有门店名）
 * ```
 *
 * ⚠️ 携程必须核对 ID：`hotelName` 是**账号主酒店**的名字，拿它去配另一个 ID 会把
 * 名字安到别家店头上。美团一个账号挂多店，同理只取匹配的那一条。
 */
export function otaHotelNameOf(
  channel: string,
  otaHotelId: string,
  credentialExtra: JsonObject | null,
): string | null {
  if (otaHotelId === '' || credentialExtra === null) return null;

  if (channel === 'ctrip') {
    return idText(credentialExtra.masterHotelId) === otaHotelId
      ? nonBlank(credentialExtra.hotelName)
      : null;
  }

  if (channel === 'meituan') {
    const pois = credentialExtra[MEITUAN_POIS_FIELD];
    if (!Array.isArray(pois)) return null;
    for (const poi of pois) {
      if (typeof poi !== 'object' || poi === null || Array.isArray(poi)) continue;
      if (idText(poi.poiId) === otaHotelId) return nonBlank(poi.poiName);
    }
  }
  return null;
}

/** 数字或非空字符串形式的 ID 统一成字符串，其余 null。 */
function idText(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function nonBlank(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
