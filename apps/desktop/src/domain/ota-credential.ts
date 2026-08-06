import type { ChannelId, OtaCredentialId } from './identity';
import type { JsonObject } from './json';

export type OtaCredential = Readonly<{
  id: OtaCredentialId;
  channel: ChannelId;
  partitionName: string;
  credentialExtra: JsonObject | null;
  discoveredAt: number;
  lastRefreshedAt: number | null;
}>;

export type OtaCredentialCreateInput = OtaCredential;

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
  return { ...input };
}
