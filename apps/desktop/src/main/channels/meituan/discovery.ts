/** Identify the current Meituan session without issuing account requests in page JS. */
import type { WebContents } from 'electron';
import type { DiscoveryContext } from '../types';
import type { JsonObject } from '../../../shared/types/json';
import type { AppLogger } from '../../../shared/logging';
import { isTrustedHotelUrl } from '../trusted-hotel-url';
import {
  parseMeituanAccountDetail,
  parseMeituanCandidateIds,
  READ_MEITUAN_ACCOUNT_CANDIDATES_EXPRESSION,
} from './account-identity';
import {
  ME_API_APPKEY,
  ME_API_LOGIN_TYPE,
  MEITUAN_POI_INFOS_URL,
  MEITUAN_POIS_FIELD,
  parseMeituanPoiInfos,
  toPoiEntries,
} from './poi-infos';

const MEITUAN_HOTEL_HOSTNAME = 'me.meituan.com';
const REQUEST_TIMEOUT_MS = 5000;
const REQUEST_HEADERS = {
  Accept: 'application/json',
  'X-Requested-With': 'XMLHttpRequest',
  'M-APPKEY': ME_API_APPKEY,
  locale: 'zh-CN',
  logintype: ME_API_LOGIN_TYPE,
};

export type MeituanDiscoveryResult =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'identity-unavailable' }>
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
  context?: DiscoveryContext,
) => Promise<MeituanDiscoveryResult>;

export type PartitionFetch = (
  partitionName: string,
  url: string,
  options: RequestInit,
) => Promise<Response>;

export function createMeituanDiscovery(
  logger: AppLogger,
  partitionFetch: PartitionFetch,
): DiscoverMeituan {
  return async (partitionName, _landingUrl, webContents, context) => {
    const startedAt = Date.now();
    const selectedId = context?.identityClues?.switchToFreshDiscovery
      ? undefined
      : context?.expectedChannelAccountId?.trim();
    const mode = selectedId ? 'selected' : 'unknown';
    const current = () =>
      !webContents.isDestroyed() &&
      isTrustedHotelUrl(webContents.getURL(), MEITUAN_HOTEL_HOSTNAME) &&
      !context?.signal?.aborted &&
      (context?.isCurrent?.() ?? true);
    const finish = (kind: string) => {
      logger.info('Meituan identity discovery completed', {
        tabId: context?.tabId,
        requestId: context?.requestId,
        mode,
        kind,
        elapsedMs: Date.now() - startedAt,
      });
    };
    if (!current()) {
      finish('stale-page');
      return { kind: 'none' };
    }

    try {
      let candidateId = selectedId ?? '';
      let rawPois: unknown = null;
      if (!candidateId) {
        const clues = context?.identityClues;
        if (!context?.freshPartition && clues?.baseline === null) {
          if (clues.sawLoginPage) {
            await clues.baselinePending;
            if (clues.baseline === null) {
              finish('identity-unavailable');
              return { kind: 'identity-unavailable' };
            }
          } else {
            const rawBaseline: unknown = await webContents.executeJavaScript(
              READ_MEITUAN_ACCOUNT_CANDIDATES_EXPRESSION,
            );
            if (current()) clues.baseline = parseMeituanCandidateIds(rawBaseline);
            finish('await-login-transition');
            return { kind: 'none' };
          }
        }
        if (!context?.freshPartition && (!clues?.sawLoginPage || !clues.baseline)) {
          finish('identity-unavailable');
          return { kind: 'identity-unavailable' };
        }
        rawPois = await requestJson(MEITUAN_POI_INFOS_URL, 'session-preflight');
        if (!current() || parseMeituanPoiInfos(rawPois) === null) {
          finish('session-invalid');
          return { kind: 'none' };
        }
        const rawCandidates: unknown = await webContents.executeJavaScript(
          READ_MEITUAN_ACCOUNT_CANDIDATES_EXPRESSION,
        );
        if (!current()) {
          finish('stale-page');
          return { kind: 'none' };
        }
        const candidates = parseMeituanCandidateIds(rawCandidates).filter(
          (id) => context?.freshPartition || !clues?.baseline?.includes(id),
        );
        if (candidates.length !== 1) {
          finish('identity-unavailable');
          return { kind: 'identity-unavailable' };
        }
        candidateId = candidates[0];
      }

      const query = new URLSearchParams({
        beQueriedAccountId: candidateId,
        doQueryAccountId: candidateId,
      });
      const rawIdentity = await requestJson(
        `https://me.meituan.com/api/gw/v1/base/account/getDetail?${query.toString()}`,
        'account-detail',
      );
      if (!current()) {
        finish('stale-page');
        return { kind: 'none' };
      }
      const identity = parseMeituanAccountDetail(candidateId, rawIdentity);
      if (!identity) {
        finish('session-invalid');
        return { kind: 'none' };
      }

      if (rawPois === null) rawPois = await requestJson(MEITUAN_POI_INFOS_URL, 'poi-list');
      if (!current()) {
        finish('stale-page');
        return { kind: 'none' };
      }
      const hotels = parseMeituanPoiInfos(rawPois);
      if (hotels === null)
        logger.warn('Meituan discovery: poiInfos unavailable, scan will have no target');
      const pois = toPoiEntries(hotels ?? []);
      finish('found');
      return {
        kind: 'found',
        credential: {
          ...identity,
          credentialExtra: {
            ...identity.credentialExtra,
            [MEITUAN_POIS_FIELD]: pois as readonly JsonObject[],
          },
        },
      };
    } catch (error) {
      logger.warn('Meituan discovery request failed', {
        tabId: context?.tabId,
        requestId: context?.requestId,
        mode,
        errorType: error instanceof Error ? error.name : 'unknown',
      });
      finish('request-failed');
      return { kind: 'none' };
    }

    async function requestJson(url: string, stage: string): Promise<unknown> {
      const controller = new AbortController();
      const onCancelled = () => controller.abort();
      context?.signal?.addEventListener('abort', onCancelled, { once: true });
      if (context?.signal?.aborted) controller.abort();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<null>((resolve) => {
        timeout = setTimeout(() => {
          controller.abort();
          resolve(null);
        }, REQUEST_TIMEOUT_MS);
      });
      try {
        const result = await Promise.race([
          (async () => {
            const response = await partitionFetch(partitionName, url, {
              method: 'GET',
              headers: REQUEST_HEADERS,
              signal: controller.signal,
            });
            if (!response.ok) return null;
            return (await response.json()) as unknown;
          })(),
          deadline,
        ]);
        logger.info('Meituan discovery stage completed', {
          tabId: context?.tabId,
          requestId: context?.requestId,
          mode,
          stage,
          kind: result === null ? 'unavailable' : 'response',
          elapsedMs: Date.now() - startedAt,
        });
        return result;
      } finally {
        if (timeout) clearTimeout(timeout);
        context?.signal?.removeEventListener('abort', onCancelled);
      }
    }
  };
}
