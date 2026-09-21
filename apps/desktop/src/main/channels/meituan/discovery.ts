/**
 * 美团渠道账号身份读取。
 *
 * ## ⚠️ 这里会读一次门店列表，但**不是**绑定流程那条路
 *
 * `split-ota-hotel-prob-feature` 决策 3 把「门店/酒店探测」整体移进了
 * `hotel-prob.ts` —— 那条路产出**候选**，交给用户确认后才写 `ota_hotel`，
 * 本文件不碰它，那条边界仍然成立。
 *
 * 这里读门店是**给定时扫描用的**：扫描由定时器触发，没有任何用户请求可以取
 * `poiId`（改价上报、回读、自然读都从报文里取，只有扫描取不到），所以门店清单
 * 必须在登录时就记下来。
 *
 * ```
 * hotel-prob.ts   探测 → 候选 → 用户确认 → ota_hotel      绑定关系（用户事实）
 * 本文件          探测 → credentialExtra.pois             取数入参（渠道事实）
 * ```
 *
 * 两者同源（都调 `poiInfos`）但去向不同，互不替代。
 *
 * ⚠️ 读门店**失败不阻断登录** —— 账号身份才是这一步的交付物，门店清单缺了只是
 * 扫描不跑，下次登录会重新写。
 */
import type { WebContents } from 'electron';
import type { JsonObject } from '../../../shared/types/json';
import { safeLogErrorDetails, type AppLogger } from '../../../shared/logging';
import { isTrustedHotelUrl } from '../trusted-hotel-url';
import {
  FETCH_MEITUAN_ACCOUNT_IDENTITY_EXPRESSION,
  parseMeituanAccountIdentityCandidates,
} from './account-identity';
import {
  FETCH_MEITUAN_POI_INFOS_EXPRESSION,
  MEITUAN_POIS_FIELD,
  parseMeituanPoiInfos,
  toPoiEntries,
} from './poi-infos';

const MEITUAN_HOTEL_HOSTNAME = 'me.meituan.com';

export type MeituanDiscoveryResult =
  | Readonly<{ kind: 'none' }>
  | Readonly<{
      kind: 'found';
      credential: Readonly<{
        channelAccountId: string;
        credentialExtra: JsonObject;
      }>;
    }>;

export type DiscoverMeituan = (
  partitionName: string,
  landingUrl: string,
  webContents: WebContents,
) => Promise<MeituanDiscoveryResult>;

export function createMeituanDiscovery(logger: AppLogger): DiscoverMeituan {
  return async (_partitionName, _landingUrl, webContents) => {
    if (!isTrustedHotelUrl(webContents.getURL(), MEITUAN_HOTEL_HOSTNAME)) {
      logger.warn('Meituan discovery rejected untrusted current URL');
      return { kind: 'none' };
    }

    try {
      const rawIdentity: unknown = await webContents.executeJavaScript(
        FETCH_MEITUAN_ACCOUNT_IDENTITY_EXPRESSION,
      );
      const identity = parseMeituanAccountIdentityCandidates(rawIdentity);
      if (!identity) {
        // 与下面 catch 的区别：这里请求发出去了、也拿到了响应，只是里面没有能用的
        // 账号（多半是接口变了或未登录）；catch 那条是请求本身没成。
        logger.warn('Meituan discovery: identity response held no usable account', {
          hasResponse: rawIdentity != null,
        });
        return { kind: 'none' };
      }

      // 门店清单：扫描的枚举口径读它。失败不阻断登录 —— 见文件头。
      const pois = await discoverPois(webContents);
      return {
        kind: 'found',
        credential: {
          ...identity,
          credentialExtra: { ...identity.credentialExtra, [MEITUAN_POIS_FIELD]: pois },
        },
      };
    } catch (error) {
      logger.warn('Meituan discovery failed', {
        error: safeLogErrorDetails(error),
      });
      return { kind: 'none' };
    }
  };

  /**
   * 读该账号名下的门店清单。
   *
   * ⚠️ **取到几家写几家**，不做「取第一家」的取舍 —— 多店账号天然产出多个扫描目标。
   * 取不到时写空数组而不是省略该键：空数组说明「探测过，这个账号没有门店」，
   * 省略说明「没探测过」，两者对排查的意义不同。
   */
  async function discoverPois(webContents: WebContents): Promise<readonly JsonObject[]> {
    try {
      const raw: unknown = await webContents.executeJavaScript(FETCH_MEITUAN_POI_INFOS_EXPRESSION);
      const hotels = parseMeituanPoiInfos(raw);
      if (hotels === null) {
        logger.warn('Meituan discovery: poiInfos response unusable, scan will have no target');
        return [];
      }
      const entries = toPoiEntries(hotels);
      logger.info('Meituan discovery: poi list recorded', { poiCount: entries.length });
      return entries as unknown as readonly JsonObject[];
    } catch (error) {
      logger.warn('Meituan discovery: poiInfos failed, scan will have no target', {
        error: safeLogErrorDetails(error),
      });
      return [];
    }
  }
}
