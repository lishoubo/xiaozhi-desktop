import type { ChannelId, OtaCredentialId } from './ids';
import type { JsonObject } from './json';

export type OtaCredential = Readonly<{
  id: OtaCredentialId;
  channel: ChannelId;
  channelAccountId: string | null;
  /**
   * 「人能认出来」的账号名。渠道差异（携程 `hotelName`、抖音 `name`、美团 `login`）
   * 在写入时就抹平了，见 `channelAccountNameOf`。
   *
   * **可能为 null**：探测拿不到名字，或记录建于 migration 8 之前（历史数据不回填，
   * 下次重新探测时自然写上）。名字只做展示，缺了不该阻断任何流程。
   */
  channelAccountName: string | null;
  partitionName: string;
  credentialExtra: JsonObject | null;
  discoveredAt: number;
  lastRefreshedAt: number | null;
}>;

export type OtaCredentialCreateInput = OtaCredential;

export type OtaCredentialIdentityUpdate = Readonly<
  Pick<
    OtaCredential,
    'channelAccountId' | 'channelAccountName' | 'credentialExtra' | 'lastRefreshedAt'
  >
>;

export type OtaCredentialPartitionUpdate = Readonly<
  Pick<
    OtaCredential,
    | 'partitionName'
    | 'channelAccountId'
    | 'channelAccountName'
    | 'credentialExtra'
    | 'lastRefreshedAt'
  >
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
