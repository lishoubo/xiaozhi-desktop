/**
 * 携程酒店探测不操作页面——账号身份归并流程（ota-credential 侧）已经从酒店 DOM
 * 顺带解析出酒店 ID/名称并保存进 `OtaCredential.credentialExtra`
 * （`{hotelId, hotelName, identitySource}`）。这里只需要解析这份已保存的数据，
 * 不重复读取或操作携程页面。
 */
import { z } from 'zod';
import { toOtaHotelId } from '../../../../../domain/identity';
import type { HotelProbe, HotelProbeOutcome } from '../../hotel-prob-port';

const ctripCredentialExtraSchema = z.object({
  hotelId: z.string(),
  hotelName: z.string(),
});

export const ctripHotelProbe: HotelProbe = {
  isProbeableUrl(): boolean {
    return true;
  },

  async probe(credential): Promise<HotelProbeOutcome> {
    const parsed = ctripCredentialExtraSchema.safeParse(credential.credentialExtra);
    if (!parsed.success) return { kind: 'none' };

    const hotelId = parsed.data.hotelId.trim();
    const hotelName = parsed.data.hotelName.trim();
    if (hotelId.length === 0 || hotelName.length === 0) return { kind: 'none' };

    return {
      kind: 'found',
      hotels: [
        {
          otaHotelId: toOtaHotelId(hotelId),
          otaHotelName: hotelName,
          bindExtra: null,
        },
      ],
    };
  },
};
