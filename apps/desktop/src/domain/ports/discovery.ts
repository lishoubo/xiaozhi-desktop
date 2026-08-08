/**
 * 登录 URL 判据接口。见 `openspec/changes/cookie-login-account-discovery/
 * design.md` 决策 8。
 */
import type { ChannelId } from '../identity';

/**
 * 判断登录标签页的 URL 是否已经离开登录页——命中即视为登录成功，触发探测。
 * 见 design.md 决策 8。渠道未注册 matcher 时不参与 URL 触发。
 */
export interface LoginUrlMatcher {
  readonly channel: ChannelId;
  isPastLogin(url: string): boolean;
}
