/** 一个 credential 名下探测出的一家可操作渠道酒店。 */
import type { ChannelId, OtaCredentialId, OtaHotelId, OtaHotelProbId } from './identity';
import type { JsonObject } from './json';

export type OtaHotelProb = Readonly<{
  id: OtaHotelProbId;
  credentialId: OtaCredentialId;
  channel: ChannelId;
  otaHotelId: OtaHotelId;
  otaHotelName: string | null;
  bindExtra: JsonObject | null;
  discoveredAt: number;
}>;

export type OtaHotelProbCreateInput = Readonly<{
  id: OtaHotelProbId;
  credentialId: OtaCredentialId;
  channel: ChannelId;
  otaHotelId: OtaHotelId;
  otaHotelName: string | null;
  bindExtra: JsonObject | null;
  discoveredAt: number;
}>;

export type OtaHotelProbDiscoveryUpdate = Readonly<
  Pick<OtaHotelProb, 'credentialId' | 'otaHotelName' | 'bindExtra' | 'discoveredAt'>
>;

export class InvalidOtaHotelProbError extends Error {
  constructor(reason: string) {
    super(`无效的 OtaHotelProb：${reason}`);
    this.name = 'InvalidOtaHotelProbError';
  }
}

export function createOtaHotelProb(input: OtaHotelProbCreateInput): OtaHotelProb {
  if (input.credentialId.length === 0) {
    throw new InvalidOtaHotelProbError('credentialId 不能为空');
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
