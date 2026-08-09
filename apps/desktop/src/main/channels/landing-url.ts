/**
 * 已绑定登录凭据"再次打开"时该落地到哪个 URL —— 流程B（`createWithAlreadyPartition`）
 * 用它拼出目标页面，不需要重新走登录流程。见
 * `openspec/changes/douyin-multi-account-nav/design.md` §6.2。
 */
import type { ChannelId } from '../ids';

const CTRIP_MANAGEMENT_URL = 'https://ebooking.ctrip.com/home/mainland';
/**
 * 抖音落地到**登录页**而不是 `/p/home`，是这里唯一与另外两家不同的地方，原因在
 * 判据：`douyinLoginUrlMatcher` 要求 `/p/home` 且带 `groupid`，而 `groupid` 是抖音
 * 在登录后才给出的（单门店账号直接重定向带上，多门店账号先停在选公司页，用户选完
 * 才带上）——我们拼不出它。写死 `/p/home` 等于给了一个判据上永远不命中的地址：
 * 登录判定卡在 `not-yet-past-login`，门店探测因此从不触发，绑定流程停在首页。
 *
 * 落到登录页则与「首次导入 Cookie」完全同一条路：cookie 还在就自动跳转，多门店账号
 * 由用户选公司，落点始终是抖音自己给的带 `groupid` 地址。
 */
const DOUYIN_LOGIN_URL = 'https://life.douyin.com/p/login';
const MEITUAN_HOME_URL =
  'https://me.meituan.com/ebooking/merchant/ebIframe' +
  '?iUrl=%2Febooking%2Fnew-workbench%2Findex.html%23%2F';

const CHANNEL_DEFAULT_URLS: ReadonlyMap<string, string> = new Map([
  ['ctrip', CTRIP_MANAGEMENT_URL],
  ['douyin', DOUYIN_LOGIN_URL],
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
