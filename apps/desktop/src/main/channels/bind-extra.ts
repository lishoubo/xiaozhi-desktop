import type { JsonObject } from '../../shared/types/json';

export function douyinBindExtra(merchantGroupId: string): JsonObject {
  return { merchantGroupId };
}

export function meituanBindExtra(
  otaPartnerId: string | null,
  otaPartnerName: string | null,
): JsonObject | null {
  if (otaPartnerId === null && otaPartnerName === null) return null;
  return { otaPartnerId, otaPartnerName };
}

/**
 * 提交给远端时把本次使用的渠道账号标识合进绑定上下文，让远端记录**自带账号关联**
 * ——此后「这条绑定是哪个账号建的」不必再绕本地 `ota_hotel` 反查。
 *
 * 为空时**省略字段**而不是写 `null`：写了 null，下次读取就分不清「没有这个字段」
 * 和「这个字段是空的」。
 */
export function withChannelAccountId(
  bindExtra: JsonObject | null,
  channelAccountId: string | null,
): JsonObject | null {
  if (channelAccountId === null || channelAccountId.length === 0) return bindExtra;
  return { ...bindExtra, channelAccountId };
}

/** 读回上面写入的账号标识；老记录没有这个字段，返回 null。 */
export function channelAccountIdFromBindExtra(bindExtra: JsonObject | null): string | null {
  if (bindExtra === null) return null;
  const value = bindExtra.channelAccountId;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function merchantGroupIdFromBindExtra(bindExtra: JsonObject | null): string | null {
  if (bindExtra === null) return null;
  const value = bindExtra.merchantGroupId;
  return typeof value === 'string' && value.length > 0 ? value : null;
}
