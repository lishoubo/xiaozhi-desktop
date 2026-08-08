/** 一个 credential 名下探测出的一家可操作渠道酒店。 */
import type { ChannelId, OtaCredentialId, OtaHotelId } from './identity';
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

export class InvalidOtaHotelError extends Error {
  constructor(reason: string) {
    super(`无效的 OtaHotel：${reason}`);
    this.name = 'InvalidOtaHotelError';
  }
}

export function createOtaHotel(input: OtaHotelCreateInput): OtaHotel {
  if (input.credentialId.length === 0) {
    throw new InvalidOtaHotelError('credentialId 不能为空');
  }
  return {
    id: input.id,
    credentialId: input.credentialId,
    channel: input.channel,
    otaHotelId: input.otaHotelId,
    otaHotelName: input.otaHotelName,
    bindExtra: input.bindExtra,
    discoveredAt: input.discoveredAt,
  };
}
