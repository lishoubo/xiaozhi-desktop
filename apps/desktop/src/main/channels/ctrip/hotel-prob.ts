/**
 * 携程酒店探测不操作页面——账号身份归并流程（ota-credential 侧）已经顺手把当前
 * 酒店存进了 `OtaCredential.credentialExtra`，这里只解析那份已保存的数据。
 *
 * 字段随身份口径改过一次（见 `account-identity.ts`）：
 *
 * ```
 * 新（HEAppInfo）    { masterHotelId, hotelName }
 * 旧（酒店 DOM）      { hotelId,       hotelName }
 * ```
 *
 * 两种都要认：老 credential 不迁移（沿用 migration 8 「下次重新探测时自然写上」
 * 的惯例），只认新字段会让老账号的酒店探测当场失效——而那正是绑定流程的入口。
 */
import { z } from 'zod';
import { toOtaHotelId } from '../../ids';
import type { HotelProbe, HotelProbeOutcome } from '../types';

/**
 * 两种字段名都收，取到哪个算哪个。`hotelName` 两代通用。
 * 用 `looseObject` 而非严格对象：`credentialExtra` 里还有账号字段，不该因为
 * 多了它们就判定解析失败。
 */
const ctripCredentialExtraSchema = z.looseObject({
  masterHotelId: z.union([z.string(), z.number()]).nullish(),
  hotelId: z.union([z.string(), z.number()]).nullish(),
  hotelName: z.string().nullish(),
});

function hotelIdOf(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  // 携程用 -1 表达「无」。
  if (normalized.length === 0 || normalized === '0' || normalized === '-1') return null;
  return normalized;
}

export const ctripHotelProbe: HotelProbe = {
  isProbeableUrl(): boolean {
    return true;
  },

  async probe(credential): Promise<HotelProbeOutcome> {
    const parsed = ctripCredentialExtraSchema.safeParse(credential.credentialExtra);
    if (!parsed.success) return { kind: 'none' };

    const hotelId = hotelIdOf(parsed.data.masterHotelId) ?? hotelIdOf(parsed.data.hotelId);
    if (hotelId === null) return { kind: 'none' };

    const hotelName = parsed.data.hotelName?.trim();

    return {
      kind: 'found',
      hotels: [
        {
          otaHotelId: toOtaHotelId(hotelId),
          // 名字缺失不阻断：`ProbedHotel.otaHotelName` 本就可空，
          // 定位靠 ID，名字只做展示。
          otaHotelName: hotelName && hotelName.length > 0 ? hotelName : null,
          bindExtra: null,
        },
      ],
    };
  },
};
