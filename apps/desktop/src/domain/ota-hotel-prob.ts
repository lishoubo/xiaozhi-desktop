/**
 * 一个 credential 名下探测出的一家可操作渠道酒店。与 OtaCredential 的关系、字段
 * 语义均对齐 OtaAccount；OtaHotelProb 是独立探测流程的持久化目标，不是
 * OtaAccount 的替代别名——两者当前并存（见
 * openspec/changes/split-ota-hotel-prob-feature/design.md 决策 7）。
 */
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
