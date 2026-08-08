import type { WebContents } from 'electron';
import type { JsonObject } from '../../../shared/types/json';
import type { AppLogger } from '../../../shared/logging';
import { isTrustedHotelUrl } from '../trusted-hotel-url';
import {
  parseCtripHotelDom,
  READ_CTRIP_HOTELS_EXPRESSION,
  type CtripDiscoveredHotel,
} from './hotel-dom';

const CTRIP_HOTEL_HOSTNAME = 'ebooking.ctrip.com';

export type CtripDiscoveryResult =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'multiple'; hotels: readonly CtripDiscoveredHotel[] }>
  | Readonly<{
      kind: 'found';
      credential: Readonly<{
        channelAccountId: string;
        credentialExtra: JsonObject;
      }>;
      hotels: readonly [CtripDiscoveredHotel];
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
      const raw: unknown = await webContents.executeJavaScript(READ_CTRIP_HOTELS_EXPRESSION);
      const hotels = parseCtripHotelDom(raw);
      if (!hotels || hotels.length === 0) {
        logger.warn('Ctrip discovery returned no valid hotels');
        return { kind: 'none' };
      }
      if (hotels.length > 1) return { kind: 'multiple', hotels };

      const hotel = hotels[0];
      return {
        kind: 'found',
        credential: {
          channelAccountId: hotel.otaHotelId,
          credentialExtra: {
            hotelId: hotel.otaHotelId,
            hotelName: hotel.otaHotelName,
            identitySource: 'hotel-dom',
          },
        },
        hotels: [hotel],
      };
    } catch (error) {
      logger.warn('Ctrip discovery failed', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      return { kind: 'none' };
    }
  };
}
