import type { ChannelId, OtaCredentialId } from './ids';
import type { JsonObject } from './json';

export type OtaCredential = Readonly<{
  id: OtaCredentialId;
  channel: ChannelId;
  channelAccountId: string | null;
  partitionName: string;
  credentialExtra: JsonObject | null;
  discoveredAt: number;
  lastRefreshedAt: number | null;
}>;

export type OtaCredentialCreateInput = OtaCredential;

export type OtaCredentialIdentityUpdate = Readonly<
  Pick<OtaCredential, 'channelAccountId' | 'credentialExtra' | 'lastRefreshedAt'>
>;

export type OtaCredentialPartitionUpdate = Readonly<
  Pick<OtaCredential, 'partitionName' | 'channelAccountId' | 'credentialExtra' | 'lastRefreshedAt'>
>;

export class InvalidOtaCredentialError extends Error {
  constructor(reason: string) {
    super(`无效的 OtaCredential：${reason}`);
    this.name = 'InvalidOtaCredentialError';
  }
}

export function createOtaCredential(input: OtaCredentialCreateInput): OtaCredential {
  if (input.id.length === 0) {
    throw new InvalidOtaCredentialError('id 不能为空');
  }
  if (input.partitionName.length === 0) {
    throw new InvalidOtaCredentialError('partitionName 不能为空');
  }
  if (input.channelAccountId !== null && input.channelAccountId.trim().length === 0) {
    throw new InvalidOtaCredentialError('channelAccountId 不能为空白字符串');
  }
  return { ...input };
}
