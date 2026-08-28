/**
 * 美团渠道账号身份读取。只读账号身份接口，不再读门店列表——门店/酒店探测已
 * 整体移入 `main/channels/meituan/hotel-prob.ts`，见
 * openspec/changes/split-ota-hotel-prob-feature/design.md 决策 3。
 */
import type { WebContents } from 'electron';
import type { JsonObject } from '../../../shared/types/json';
import { safeLogErrorDetails, type AppLogger } from '../../../shared/logging';
import { isTrustedHotelUrl } from '../trusted-hotel-url';
import {
  FETCH_MEITUAN_ACCOUNT_IDENTITY_EXPRESSION,
  parseMeituanAccountIdentityCandidates,
} from './account-identity';

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

      return { kind: 'found', credential: identity };
    } catch (error) {
      logger.warn('Meituan discovery failed', {
        error: safeLogErrorDetails(error),
      });
      return { kind: 'none' };
    }
  };
}
