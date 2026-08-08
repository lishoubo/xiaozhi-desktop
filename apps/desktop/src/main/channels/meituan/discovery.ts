/**
 * 美团渠道账号身份读取。只读账号身份接口，不再读门店列表——门店/酒店探测已
 * 整体移入 `main/channels/meituan/hotel-prob.ts`，见
 * openspec/changes/split-ota-hotel-prob-feature/design.md 决策 3。
 */
import type { WebContents } from 'electron';
import type { JsonObject } from '../../../domain/json';
import type { AppLogger } from '../../../shared/logging';
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
        logger.warn('Meituan account identity discovery returned no valid account');
        return { kind: 'none' };
      }

      return { kind: 'found', credential: identity };
    } catch (error) {
      logger.warn('Meituan discovery failed', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      return { kind: 'none' };
    }
  };
}
