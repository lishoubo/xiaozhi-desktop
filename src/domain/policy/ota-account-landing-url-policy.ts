/**
 * 已绑定账号"再次打开"时该落地到哪个 URL —— 流程B（`createWithAlreadyPartition`）
 * 用它拼出目标页面，不需要重新走登录流程。见
 * `openspec/changes/douyin-multi-account-nav/design.md` §6.2。
 */
import type { ChannelId } from '../identity';
import type { OtaAccount } from '../ota-account';

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

/**
 * 抖音场景 `channelContext` 存 groupid，拼回门店首页；缺失时（历史数据、
 * 探测未能解析出 groupid）退化到不带 groupid 的登录后台首页，而不是
 * 直接报错让用户完全打不开——落地页仍然是这份 partition 的登录态，用户
 * 能看到自己账号下的公司/门店列表，只是没有直接跳到对应门店。
 * 其余渠道用渠道默认 URL。
 */
export function otaAccountLandingUrl(
  account: Pick<OtaAccount, 'channel' | 'channelContext'>,
): string {
  if (account.channel === 'douyin' && account.channelContext) {
    return `${DOUYIN_HOME_URL}?groupid=${encodeURIComponent(account.channelContext)}`;
  }
  const defaultUrl = CHANNEL_DEFAULT_URLS.get(account.channel);
  if (!defaultUrl) throw new UnsupportedChannelForLandingUrlError(account.channel);
  return defaultUrl;
}
