/**
 * 已绑定账号"再次打开"时该落地到哪个 URL —— 流程B（`createWithAlreadyPartition`）
 * 用它拼出目标页面，不需要重新走登录流程。见
 * `openspec/changes/douyin-multi-account-nav/design.md` §6.2。
 */
import type { ChannelId } from '../identity';
import type { OtaAccount } from '../ota-account';

const CTRIP_MANAGEMENT_URL = 'https://ebooking.ctrip.com/home/mainland';

const CHANNEL_DEFAULT_URLS: ReadonlyMap<string, string> = new Map([['ctrip', CTRIP_MANAGEMENT_URL]]);

export class UnsupportedChannelForLandingUrlError extends Error {
  constructor(channel: ChannelId) {
    super(`渠道 ${channel} 没有可打开的落地页`);
    this.name = 'UnsupportedChannelForLandingUrlError';
  }
}

/** 抖音场景 `channelContext` 存 groupid，拼回门店首页；其余渠道用渠道默认 URL。 */
export function otaAccountLandingUrl(
  account: Pick<OtaAccount, 'channel' | 'channelContext'>,
): string {
  if (account.channel === 'douyin' && account.channelContext) {
    return `https://life.douyin.com/p/home?groupid=${encodeURIComponent(account.channelContext)}`;
  }
  const defaultUrl = CHANNEL_DEFAULT_URLS.get(account.channel);
  if (!defaultUrl) throw new UnsupportedChannelForLandingUrlError(account.channel);
  return defaultUrl;
}
