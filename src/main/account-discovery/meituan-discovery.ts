/**
 * 美团门店探测——同源 XHR 调 poiInfos 接口，不用 DOM 解析（design-meituan.md 决策 10）。
 *
 * 接口与字段抄自已在 RPA 里验证过的实现：
 * rms-rpa-worker/rms_rpa_worker/ota/step/meituan/poi_fetch.py + selectors.py
 *
 * me.meituan.com 是登录态的权威 shell 域，cookie 认证 + 固定 header 即可拿到
 * 完整门店列表，不依赖页面已渲染出的 DOM，也不像抖音那样需要二次换取中间 ID。
 */
import { WebContentsView, type WebContents } from 'electron';
import { z } from 'zod';
import type { ChannelId } from '../../domain/identity';
import { toChannelId, toOtaHotelId } from '../../domain/identity';
import type { AppLogger } from '../../shared/logging';
import type { DiscoveryOutcome, DiscoveryProbe } from './discovery-probe-port';

const POI_INFOS_URL =
  'https://me.meituan.com/api/gw/v1/ampaccount/accountpoi/poiInfos' +
  '?key=auth-info-poilist&bizLine=3&permissionSpace=30&permissionCode=0&hasAccess=true' +
  '&pageSize=50&poiFields=poiId,poiName,partnerId,partnerName,mtCityId,mtCityName' +
  '&resultType=2&displayAll=false&tagSources=crossPartner&searchCondition=';

const ME_API_APPKEY = 'fe_com.sankuai.fetalos.web.hotelfeme';
const ME_API_LOGIN_TYPE = 'Epassport';
const POI_INFOS_SUCCESS_CODE = 10000;

const poiSchema = z.object({
  poiId: z.union([z.string(), z.number()]),
  poiName: z.string().optional(),
  partnerId: z.union([z.string(), z.number()]).optional(),
  partnerName: z.string().optional(),
});

const poiInfosResponseSchema = z.object({
  code: z.union([z.number(), z.string()]),
  data: z
    .object({
      twoLevelList: z
        .array(
          z.object({
            poiList: z.array(poiSchema).optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

const FETCH_POI_INFOS_EXPRESSION = `
  new Promise((resolve) => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', ${JSON.stringify(POI_INFOS_URL)}, true);
      xhr.withCredentials = true;
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
      xhr.setRequestHeader('M-APPKEY', ${JSON.stringify(ME_API_APPKEY)});
      xhr.setRequestHeader('locale', 'zh-CN');
      xhr.setRequestHeader('logintype', ${JSON.stringify(ME_API_LOGIN_TYPE)});
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch (e) {
            resolve(null);
          }
        } else {
          resolve(null);
        }
      };
      xhr.onerror = () => resolve(null);
      xhr.send(null);
    } catch (e) {
      resolve(null);
    }
  })
`;

export class MeituanDiscoveryProbe implements DiscoveryProbe {
  readonly channel: ChannelId = toChannelId('meituan');

  constructor(private readonly logger: AppLogger) {}

  /** 复用 landingUrl——登录成功判定命中时标签页已经在 me.meituan.com 域下，直接原地发起同源 XHR。 */
  async discover(partitionName: string, landingUrl: string, webContents: WebContents): Promise<DiscoveryOutcome> {
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        session: webContents.session,
      },
    });
    try {
      await view.webContents.loadURL(landingUrl);
      const raw: unknown = await view.webContents.executeJavaScript(FETCH_POI_INFOS_EXPRESSION);
      const parsed = poiInfosResponseSchema.safeParse(raw);
      if (!parsed.success) {
        this.logger.warn('Meituan discovery parse failed', { partitionName });
        return { kind: 'none' };
      }
      const { code, data } = parsed.data;
      if (String(code) !== String(POI_INFOS_SUCCESS_CODE)) {
        this.logger.warn('Meituan discovery unexpected code', { partitionName, code });
        return { kind: 'none' };
      }
      const pois = (data?.twoLevelList ?? []).flatMap((group) => group.poiList ?? []);
      const hotels = pois
        .filter((poi) => String(poi.poiId).trim().length > 0 && (poi.poiName || poi.partnerName))
        .map((poi) => ({
          otaHotelId: toOtaHotelId(String(poi.poiId)),
          otaHotelName: poi.poiName || poi.partnerName || '',
          channelContext:
            poi.partnerId || poi.partnerName
              ? JSON.stringify({
                  partnerId: poi.partnerId != null ? String(poi.partnerId) : null,
                  partnerName: poi.partnerName ?? null,
                })
              : null,
        }));
      if (hotels.length === 0) return { kind: 'none' };
      if (hotels.length === 1) return { kind: 'single', hotel: hotels[0] };
      return { kind: 'multiple', hotels };
    } catch (error) {
      this.logger.warn('Meituan discovery failed', {
        partitionName,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      return { kind: 'none' };
    } finally {
      if (!view.webContents.isDestroyed()) view.webContents.close();
    }
  }
}
