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
