/** 一个 credential 名下探测出的一家可操作渠道酒店。 */
import type { ChannelId, OtaCredentialId, OtaHotelId } from './ids';
import type { JsonObject } from './json';

export type OtaHotel = Readonly<{
  id: string;
  credentialId: OtaCredentialId;
  channel: ChannelId;
  otaHotelId: OtaHotelId;
  otaHotelName: string | null;
  bindExtra: JsonObject | null;
  discoveredAt: number;
}>;

export type OtaHotelCreateInput = Readonly<{
  id: string;
  credentialId: OtaCredentialId;
  channel: ChannelId;
  otaHotelId: OtaHotelId;
  otaHotelName: string | null;
  bindExtra: JsonObject | null;
  discoveredAt: number;
}>;

export type OtaHotelDiscoveryUpdate = Readonly<
  Pick<OtaHotel, 'credentialId' | 'otaHotelName' | 'bindExtra' | 'discoveredAt'>
>;

// 这里曾有 createOtaHotel + InvalidOtaHotelError，唯一的校验是
// `credentialId.length === 0`。但 credentialId 的类型是 branded 的
// OtaCredentialId，只能由 toOtaCredentialId() 产生，而那个函数已经校验过非空
// —— 该分支永远不可达。类型系统能保证的，不再写一遍运行时校验。
