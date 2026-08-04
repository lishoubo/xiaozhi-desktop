/**
 * 账号探测层的接口 —— 「拿到一份渠道登录态」到「知道这份登录态管哪些门店」。
 * 实现在 `main/account-discovery/`，按渠道各自封装 URL、分页、字段映射。
 * 见 `openspec/changes/cookie-login-account-discovery/design.md` 决策 2、5。
 */
import type { ChannelId, OtaHotelId } from '../identity';

export type DiscoveredOtaHotel = Readonly<{
  otaHotelId: OtaHotelId;
  displayName: string;
}>;

export type DiscoveryOutcome =
  | Readonly<{ kind: 'unsupported' }>
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'single'; hotel: DiscoveredOtaHotel }>
  | Readonly<{ kind: 'multiple'; hotels: readonly DiscoveredOtaHotel[] }>;

export interface DiscoveryProbe {
  readonly channel: ChannelId;
  discover(partitionName: string): Promise<DiscoveryOutcome>;
}

/**
 * 判断登录标签页的 URL 是否已经离开登录页——命中即视为登录成功，触发探测。
 * 见 design.md 决策 8。渠道未注册 matcher 时不参与 URL 触发。
 */
export interface LoginUrlMatcher {
  readonly channel: ChannelId;
  isPastLogin(url: string): boolean;
}
