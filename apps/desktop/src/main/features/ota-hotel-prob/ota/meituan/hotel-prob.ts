/**
 * 美团酒店探测：读门店列表接口。不重复读取账号身份——身份读取已在 ota-credential
 * 侧完成（`discover-meituan.ts`）。
 */
import { isTrustedHotelUrl } from '../../../common/ota/trusted-hotel-url';
import type { HotelProbe, HotelProbeOutcome } from '../../hotel-prob-port';
import { FETCH_MEITUAN_POI_INFOS_EXPRESSION, parseMeituanPoiInfos } from './poi-infos';

const MEITUAN_HOTEL_HOSTNAME = 'me.meituan.com';

export const meituanHotelProbe: HotelProbe = {
  isProbeableUrl(url: string): boolean {
    return isTrustedHotelUrl(url, MEITUAN_HOTEL_HOSTNAME);
  },

  async probe(_credential, webContents): Promise<HotelProbeOutcome> {
    const rawPois: unknown = await webContents.executeJavaScript(
      FETCH_MEITUAN_POI_INFOS_EXPRESSION,
    );
    const hotels = parseMeituanPoiInfos(rawPois);
    if (!hotels || hotels.length === 0) return { kind: 'none' };
    return { kind: 'found', hotels };
  },
};
