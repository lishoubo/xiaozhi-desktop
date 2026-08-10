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
 * 提交给远端时把本次使用的渠道账号身份合进绑定上下文，让远端记录**自带账号关联**
 * ——此后「这条绑定是哪个账号建的」不必再绕本地 `ota_hotel` 反查。
 *
 * 写入两个字段：`channelAccountId` 供机器匹配，`channelAccountName` 供人在酒店卡片
 * 上认账号（RMS 后台绑定的记录一直有这个字段，desktop 绑的却没有，卡片上「账号名称」
 * 因此长期空着）。名字取自凭证的 `credentialExtra`，键随渠道不同，见
 * `channelAccountNameOf`。
 *
 * 任一为空时**省略该字段**而不是写 `null`：写了 null，下次读取就分不清「没有这个
 * 字段」和「这个字段是空的」。
 */
export function withChannelAccount(
  bindExtra: JsonObject | null,
  account: Readonly<{ channelAccountId: string | null; credentialExtra: JsonObject | null }>,
): JsonObject | null {
  const channelAccountId = nonBlank(account.channelAccountId);
  const channelAccountName = channelAccountNameOf(account.credentialExtra);
  if (channelAccountId === null && channelAccountName === null) return bindExtra;
  return {
    ...bindExtra,
    ...(channelAccountId === null ? {} : { channelAccountId }),
    ...(channelAccountName === null ? {} : { channelAccountName }),
  };
}

/**
 * 凭证 `credentialExtra` 里那个「人能认出来」的名字。各渠道键不同：
 *
 * | 渠道 | 键 | 内容 |
 * |---|---|---|
 * | 携程 | `hotelName` | 酒店名 |
 * | 抖音 | `name` | 账号名 |
 * | 美团 | `login` | 登录名（美团既没有 `hotelName` 也没有 `name`） |
 *
 * 键名不重叠，所以按优先级依次取即可，不必按渠道分支。取不到返回 null——名字只是
 * 展示增强，缺了不该阻断绑定。
 */
function channelAccountNameOf(credentialExtra: JsonObject | null): string | null {
  if (credentialExtra === null) return null;
  return (
    nonBlank(credentialExtra.hotelName) ??
    nonBlank(credentialExtra.name) ??
    nonBlank(credentialExtra.login)
  );
}

function nonBlank(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
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
