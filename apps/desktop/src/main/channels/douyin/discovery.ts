/**
 * 抖音渠道账号身份读取。只读 session storage 里已缓存的登录用户身份，不碰
 * CDP debugger、不点击任何页面菜单——门店/酒店探测（点门店管理菜单 + CDP 抓
 * `dsl/get` 响应）已整体移入
 * `main/channels/douyin/hotel-prob.ts`，见
 * openspec/changes/split-ota-hotel-prob-feature/design.md 决策 3、4。
 */
import type { WebContents } from 'electron';
import type { JsonObject } from '../../../shared/types/json';
import type { AppLogger } from '../../../shared/logging';
import { isTrustedHotelUrl } from '../trusted-hotel-url';
import {
  parseDouyinAccountIdentity,
  READ_DOUYIN_ACCOUNT_IDENTITY_EXPRESSION,
} from './account-identity';

const DOUYIN_HOTEL_HOSTNAME = 'life.douyin.com';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type DouyinDiscoveryResult =
  | Readonly<{ kind: 'none' }>
  | Readonly<{
      kind: 'found';
      credential: Readonly<{
        channelAccountId: string;
        credentialExtra: JsonObject;
      }>;
    }>;

export type DiscoverDouyin = (
  partitionName: string,
  landingUrl: string,
  webContents: WebContents,
) => Promise<DouyinDiscoveryResult>;

export function createDouyinDiscovery(logger: AppLogger): DiscoverDouyin {
  return async (partitionName, _landingUrl, webContents) => {
    const currentUrl = webContents.getURL();
    if (!isTrustedHotelUrl(currentUrl, DOUYIN_HOTEL_HOSTNAME)) {
      logger.warn('Douyin discovery rejected untrusted current URL');
      return { kind: 'none' };
    }

    let credential: ReturnType<typeof parseDouyinAccountIdentity> = null;
    for (let attempt = 0; attempt < 20 && !credential; attempt += 1) {
      const accountRaw: unknown = await webContents.executeJavaScript(
        READ_DOUYIN_ACCOUNT_IDENTITY_EXPRESSION,
      );
      credential = parseDouyinAccountIdentity(accountRaw);
      if (!credential) await sleep(250);
    }
    if (!credential) {
      logger.warn('Douyin discovery: no valid account identity in session storage', {
        partitionName,
      });
      return { kind: 'none' };
    }

    return { kind: 'found', credential };
  };
}
