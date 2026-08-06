import { WebContentsView, type WebContents } from 'electron';
import type { JsonObject } from '../../../domain/json';
import type { AppLogger } from '../../../shared/logging';
import {
  FETCH_MEITUAN_ACCOUNT_IDENTITY_EXPRESSION,
  parseMeituanAccountIdentityCandidates,
} from './account-identity';
import {
  FETCH_MEITUAN_POI_INFOS_EXPRESSION,
  parseMeituanPoiInfos,
  type MeituanDiscoveredHotel,
} from './poi-infos';

export type MeituanDiscoveryResult =
  | Readonly<{ kind: 'none' }>
  | Readonly<{
      kind: 'found';
      credential: Readonly<{
        channelAccountId: string;
        credentialExtra: JsonObject;
      }>;
      hotels: readonly MeituanDiscoveredHotel[];
    }>;

export type DiscoverMeituan = (
  partitionName: string,
  landingUrl: string,
  webContents: WebContents,
) => Promise<MeituanDiscoveryResult>;

function isTrustedLandingUrl(landingUrl: string): boolean {
  try {
    const url = new URL(landingUrl);
    return url.protocol === 'https:' && url.hostname === 'me.meituan.com';
  } catch {
    return false;
  }
}

export function createMeituanDiscovery(logger: AppLogger): DiscoverMeituan {
  return async (_partitionName, landingUrl, webContents) => {
    if (!isTrustedLandingUrl(landingUrl)) {
      logger.warn('Meituan discovery rejected untrusted landing URL');
      return { kind: 'none' };
    }

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
      const rawIdentity: unknown = await view.webContents.executeJavaScript(
        FETCH_MEITUAN_ACCOUNT_IDENTITY_EXPRESSION,
      );
      const identity = parseMeituanAccountIdentityCandidates(rawIdentity);
      if (!identity) {
        logger.warn('Meituan account identity discovery returned no valid account');
        return { kind: 'none' };
      }

      const rawPois: unknown = await view.webContents.executeJavaScript(
        FETCH_MEITUAN_POI_INFOS_EXPRESSION,
      );
      const hotels = parseMeituanPoiInfos(rawPois);
      if (!hotels || hotels.length === 0) {
        logger.warn('Meituan hotel discovery returned no valid hotels');
        return { kind: 'none' };
      }

      logger.info('Meituan discovery completed', { hotelCount: hotels.length });
      return { kind: 'found', credential: identity, hotels };
    } catch (error) {
      logger.warn('Meituan discovery failed', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      return { kind: 'none' };
    } finally {
      if (!view.webContents.isDestroyed()) view.webContents.close();
    }
  };
}
