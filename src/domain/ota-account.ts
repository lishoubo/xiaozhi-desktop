/**
 * 一个可操作的渠道门店账号。见 `docs/arch/2026-08-03-domain-model.md` §2.0。
 *
 * `partitionName` 是这份登录态唯一的权威指针——要使用这个账号，永远是
 * `session.fromPartition(partitionName)`，cookie 内容不进这个类型、不进数据库。
 */
import type { ChannelId, OtaAccountId, OtaHotelId } from './identity';

export type OtaAccount = Readonly<{
  id: OtaAccountId;
  channel: ChannelId;
  otaHotelId: OtaHotelId;
  otaHotelName: string | null;
  partitionName: string;
  /** 渠道特定的免登录跳转上下文，抖音存 groupid；携程恒为 null。见 design.md §2.1。 */
  channelContext: string | null;
  /** 这条账号记录最近一次建号/更新的时间（epoch ms），listByChannel 排序用。 */
  discoveredAt: number;
}>;

export type OtaAccountCreateInput = Readonly<{
  id: OtaAccountId;
  channel: ChannelId;
  otaHotelId: OtaHotelId;
  otaHotelName: string | null;
  partitionName: string;
  channelContext: string | null;
  discoveredAt: number;
}>;

export class InvalidOtaAccountError extends Error {
  constructor(reason: string) {
    super(`无效的 OtaAccount：${reason}`);
    this.name = 'InvalidOtaAccountError';
  }
}

export function createOtaAccount(input: OtaAccountCreateInput): OtaAccount {
  if (input.partitionName.length === 0) {
    throw new InvalidOtaAccountError('partitionName 不能为空');
  }
  return {
    id: input.id,
    channel: input.channel,
    otaHotelId: input.otaHotelId,
    otaHotelName: input.otaHotelName,
    partitionName: input.partitionName,
    channelContext: input.channelContext,
    discoveredAt: input.discoveredAt,
  };
}
