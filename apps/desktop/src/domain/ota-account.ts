/**
 * 一个 credential 已发现的可操作渠道门店。登录态由 OtaCredential 持有。
 */
import type { ChannelId, OtaAccountId, OtaCredentialId, OtaHotelId } from './identity';
import type { JsonObject } from './json';

export type OtaAccount = Readonly<{
  id: OtaAccountId;
  credentialId: OtaCredentialId;
  channel: ChannelId;
  otaHotelId: OtaHotelId;
  otaHotelName: string | null;
  bindExtra: JsonObject | null;
  /** 这条账号记录最近一次建号/更新的时间（epoch ms），listByChannel 排序用。 */
  discoveredAt: number;
}>;

export type OtaAccountCreateInput = Readonly<{
  id: OtaAccountId;
  credentialId: OtaCredentialId;
  channel: ChannelId;
  otaHotelId: OtaHotelId;
  otaHotelName: string | null;
  bindExtra: JsonObject | null;
  discoveredAt: number;
}>;

export type OtaAccountDiscoveryUpdate = Readonly<
  Pick<OtaAccount, 'credentialId' | 'otaHotelName' | 'bindExtra' | 'discoveredAt'>
>;

export class InvalidOtaAccountError extends Error {
  constructor(reason: string) {
    super(`无效的 OtaAccount：${reason}`);
    this.name = 'InvalidOtaAccountError';
  }
}

export function createOtaAccount(input: OtaAccountCreateInput): OtaAccount {
  if (input.credentialId.length === 0) {
    throw new InvalidOtaAccountError('credentialId 不能为空');
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
