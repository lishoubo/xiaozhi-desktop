import { z } from 'zod';
import { toOtaHotelId, type OtaHotelId } from '../../ids';
import type { JsonObject } from '../../../shared/types/json';
import { meituanBindExtra } from '../../channels/bind-extra';

const MEITUAN_SUCCESS_CODE = 10000;
export const ME_API_APPKEY = 'fe_com.sankuai.fetalos.web.hotelfeme';
export const ME_API_LOGIN_TYPE = 'Epassport';

export const MEITUAN_POI_INFOS_URL =
  'https://me.meituan.com/api/gw/v1/ampaccount/accountpoi/poiInfos' +
  '?key=auth-info-poilist&bizLine=3&permissionSpace=30&permissionCode=0&hasAccess=true' +
  '&pageSize=50&poiFields=poiId,poiName,partnerId,partnerName,mtCityId,mtCityName' +
  '&resultType=2&displayAll=false&tagSources=crossPartner&searchCondition=';

const poiSchema = z.object({
  poiId: z.union([z.string(), z.number()]),
  poiName: z.string().optional(),
  partnerId: z.union([z.string(), z.number()]).optional(),
  partnerName: z.string().optional(),
});

const poiInfosResponseSchema = z.object({
  code: z.union([z.number(), z.string()]),
  data: z.object({
    twoLevelList: z.array(z.object({ poiList: z.array(poiSchema).optional() })).optional(),
  }),
});

/**
 * 扫描要的门店条目 —— 存进 `credentialExtra.pois`。
 *
 * ⚠️ `otaPartnerId` 是**门店级**商户号，与 `credentialExtra` 外层那个 `partnerId`
 * （**账号级**，来自 `account/getDetail`）**不是同一个值**。刻意换个名字，与
 * `bindExtra.otaPartnerId` 的叫法对齐，免得在同一个对象里看混。
 */
export type MeituanPoiEntry = Readonly<{
  poiId: string;
  otaPartnerId: string | null;
  poiName: string;
}>;

/** `credentialExtra` 里存门店清单的键。扫描的枚举口径读它。 */
export const MEITUAN_POIS_FIELD = 'pois';

/** 把探测结果转成 `credentialExtra.pois` 的形状。 */
export function toPoiEntries(hotels: readonly MeituanDiscoveredHotel[]): MeituanPoiEntry[] {
  return hotels.map((hotel) => ({
    poiId: String(hotel.otaHotelId),
    otaPartnerId:
      typeof hotel.bindExtra?.otaPartnerId === 'string' ? hotel.bindExtra.otaPartnerId : null,
    poiName: hotel.otaHotelName,
  }));
}

export type MeituanDiscoveredHotel = Readonly<{
  otaHotelId: OtaHotelId;
  otaHotelName: string;
  bindExtra: JsonObject | null;
}>;

export function parseMeituanPoiInfos(raw: unknown): readonly MeituanDiscoveredHotel[] | null {
  const parsed = poiInfosResponseSchema.safeParse(raw);
  if (!parsed.success || String(parsed.data.code) !== String(MEITUAN_SUCCESS_CODE)) return null;

  return (parsed.data.data.twoLevelList ?? [])
    .flatMap((group) => group.poiList ?? [])
    .flatMap((poi): readonly MeituanDiscoveredHotel[] => {
      const otaHotelId = String(poi.poiId).trim();
      const otaHotelName = poi.poiName?.trim() || poi.partnerName?.trim() || '';
      if (otaHotelId.length === 0 || otaHotelName.length === 0) return [];
      return [
        {
          otaHotelId: toOtaHotelId(otaHotelId),
          otaHotelName,
          bindExtra: meituanBindExtra(
            poi.partnerId == null ? null : String(poi.partnerId),
            poi.partnerName ?? null,
          ),
        },
      ];
    });
}

export const FETCH_MEITUAN_POI_INFOS_EXPRESSION = `
  new Promise((resolve) => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', ${JSON.stringify(MEITUAN_POI_INFOS_URL)}, true);
      xhr.withCredentials = true;
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
      xhr.setRequestHeader('M-APPKEY', ${JSON.stringify(ME_API_APPKEY)});
      xhr.setRequestHeader('locale', 'zh-CN');
      xhr.setRequestHeader('logintype', ${JSON.stringify(ME_API_LOGIN_TYPE)});
      xhr.onload = () => {
        if (xhr.status < 200 || xhr.status >= 300) {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (error) {
          resolve(null);
        }
      };
      xhr.onerror = () => resolve(null);
      xhr.send(null);
    } catch (error) {
      resolve(null);
    }
  })
`;
