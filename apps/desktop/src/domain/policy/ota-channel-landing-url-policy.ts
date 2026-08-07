/**
 * 已绑定登录凭据"再次打开"时该落地到哪个 URL —— 流程B（`createWithAlreadyPartition`）
 * 用它拼出目标页面，不需要重新走登录流程。见
 * `openspec/changes/douyin-multi-account-nav/design.md` §6.2。
 */
import type { ChannelId } from '../identity';

const CTRIP_MANAGEMENT_URL = 'https://ebooking.ctrip.com/home/mainland';
const DOUYIN_HOME_URL = 'https://life.douyin.com/p/home';
const MEITUAN_HOME_URL =
  'https://me.meituan.com/ebooking/merchant/ebIframe' +
  '?iUrl=%2Febooking%2Fnew-workbench%2Findex.html%23%2F';

const CHANNEL_DEFAULT_URLS: ReadonlyMap<string, string> = new Map([
  ['ctrip', CTRIP_MANAGEMENT_URL],
  ['douyin', DOUYIN_HOME_URL],
  ['meituan', MEITUAN_HOME_URL],
]);

export class UnsupportedChannelForLandingUrlError extends Error {
  constructor(channel: ChannelId) {
    super(`渠道 ${channel} 没有可打开的落地页`);
    this.name = 'UnsupportedChannelForLandingUrlError';
  }
}

export function otaChannelLandingUrl(channel: ChannelId): string {
  const defaultUrl = CHANNEL_DEFAULT_URLS.get(channel);
  if (!defaultUrl) throw new UnsupportedChannelForLandingUrlError(channel);
  return defaultUrl;
}
