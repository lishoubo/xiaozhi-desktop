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

/**
 * 身份写进 session storage 的等待上限。
 *
 * 原为 5s（20 × 250ms），是三个渠道里最容易偶发失败的一个：页面稍慢就超时返回
 * `none`，用户看到「登录成功但账号没出来」。同目录 `hotel-prob.ts` 等 CDP 响应用
 * 的是 30s——那是「点菜单 + 等页面 + 等接口」的完整链路，这里只是等前端把已登录
 * 身份写进 storage，取它的一半量级即可。
 */
const IDENTITY_WAIT_TIMEOUT_MS = 15000;
const IDENTITY_POLL_INTERVAL_MS = 250;
const IDENTITY_MAX_ATTEMPTS = IDENTITY_WAIT_TIMEOUT_MS / IDENTITY_POLL_INTERVAL_MS;

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
    // 区分两种失败：storage 里一直是空的（页面没就绪 / 其实没登录），还是读到了东西
    // 但解析不出来（抖音改了字段）。两者原先同一句 warn，真机排查时分不出该等还是
    // 该改解析。只记最后一次的状况——中间轮次为空是正常的等待过程。
    let sawRawValue = false;
    for (let attempt = 0; attempt < IDENTITY_MAX_ATTEMPTS && !credential; attempt += 1) {
      const accountRaw: unknown = await webContents.executeJavaScript(
        READ_DOUYIN_ACCOUNT_IDENTITY_EXPRESSION,
      );
      sawRawValue = accountRaw != null;
      credential = parseDouyinAccountIdentity(accountRaw);
      if (!credential) await sleep(IDENTITY_POLL_INTERVAL_MS);
    }
    if (!credential) {
      logger.warn(
        sawRawValue
          ? 'Douyin discovery: account identity in session storage could not be parsed'
          : 'Douyin discovery: session storage held no account identity before timeout',
        { partitionName, waitedMs: IDENTITY_WAIT_TIMEOUT_MS },
      );
      return { kind: 'none' };
    }

    return { kind: 'found', credential };
  };
}
