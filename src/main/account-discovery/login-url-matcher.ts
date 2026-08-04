import type { ChannelId } from '../../domain/identity';
import type { LoginUrlMatcher } from '../../domain/ports/discovery';
import { ctripLoginUrlMatcher } from './ctrip-login-url-matcher';
import { douyinLoginUrlMatcher } from './douyin-login-url-matcher';

/** channel → LoginUrlMatcher registry。未注册的渠道不参与 URL 触发（decision 8）。 */
export const LOGIN_URL_MATCHERS: ReadonlyMap<ChannelId, LoginUrlMatcher> = new Map([
  [ctripLoginUrlMatcher.channel, ctripLoginUrlMatcher],
  [douyinLoginUrlMatcher.channel, douyinLoginUrlMatcher],
]);
