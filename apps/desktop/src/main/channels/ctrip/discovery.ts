/**
 * 携程渠道账号身份读取。取 `window.HEAppInfo.getUserInfo()` 的 `huid` 当身份，
 * 顺手把 `getHotelInfo()` 的酒店存进 `credentialExtra`（`ctripHotelProbe` 读它，
 * 不碰页面）。为什么不再拿酒店 ID 当账号身份，见 `account-identity.ts` 顶部。
 */
import type { WebContents } from 'electron';
import type { JsonObject } from '../../../shared/types/json';
import type { AppLogger } from '../../../shared/logging';
import { isTrustedHotelUrl } from '../trusted-hotel-url';
import {
  parseCtripAccountIdentity,
  READ_CTRIP_ACCOUNT_IDENTITY_EXPRESSION,
} from './account-identity';

const CTRIP_HOTEL_HOSTNAME = 'ebooking.ctrip.com';

export type CtripDiscoveryResult =
  | Readonly<{ kind: 'none' }>
  | Readonly<{
      kind: 'found';
      credential: Readonly<{
        channelAccountId: string;
        credentialExtra: JsonObject;
      }>;
    }>;

export type DiscoverCtrip = (
  partitionName: string,
  landingUrl: string,
  webContents: WebContents,
) => Promise<CtripDiscoveryResult>;

export function createCtripDiscovery(logger: AppLogger): DiscoverCtrip {
  return async (_partitionName, _landingUrl, webContents) => {
    if (!isTrustedHotelUrl(webContents.getURL(), CTRIP_HOTEL_HOSTNAME)) {
      logger.warn('Ctrip discovery rejected untrusted current URL');
      return { kind: 'none' };
    }

    try {
      const raw: unknown = await webContents.executeJavaScript(
        READ_CTRIP_ACCOUNT_IDENTITY_EXPRESSION,
      );
      const identity = parseCtripAccountIdentity(raw);
      if (!identity) {
        // 区分「页面上压根没有身份对象」与「有但解析不出」：前者多半是 SDK 还没
        // 加载完或落错了页，后者说明携程改了字段。原先这里只有一句笼统的 warn。
        logger.warn(
          raw == null
            ? 'Ctrip discovery: neither HEAppInfo nor HEUbtBaseData exposed an account'
            : 'Ctrip discovery: account identity could not be parsed',
        );
        return { kind: 'none' };
      }

      logger.info('Ctrip discovery read account identity', {
        identitySource: identity.credentialExtra.identitySource,
        hasHotel: identity.credentialExtra.masterHotelId !== null,
      });
      return { kind: 'found', credential: identity };
    } catch (error) {
      logger.warn('Ctrip discovery failed', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      return { kind: 'none' };
    }
  };
}
