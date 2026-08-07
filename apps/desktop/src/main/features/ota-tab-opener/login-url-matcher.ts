import type { ChannelId } from '../../../domain/identity';
import type { LoginUrlMatcher } from '../../../domain/ports/discovery';
import { ctripLoginUrlMatcher } from '../ota-credential/ota/ctrip/login-url-matcher';
import { douyinLoginUrlMatcher } from '../ota-credential/ota/douyin/login-url-matcher';
import { meituanLoginUrlMatcher } from '../ota-credential/ota/meituan/login-url-matcher';

/** channel → LoginUrlMatcher registry。未注册的渠道不参与 URL 触发（decision 8）。 */
export const LOGIN_URL_MATCHERS: ReadonlyMap<ChannelId, LoginUrlMatcher> = new Map([
  [ctripLoginUrlMatcher.channel, ctripLoginUrlMatcher],
  [douyinLoginUrlMatcher.channel, douyinLoginUrlMatcher],
  [meituanLoginUrlMatcher.channel, meituanLoginUrlMatcher],
]);
