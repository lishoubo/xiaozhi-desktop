/**
 * 扫描轮末的失效目标 → 界面提醒要的账号汇总。
 *
 * ```
 * expired: ScanTarget[]              一个目标 = 一家门店
 *   按 partitionName 分组            美团一个账号挂多店，多店失效只算一个账号
 *   → 查凭证取账号名与门店名
 *   → accounts                        一个账号一条
 * ```
 *
 * 抽成纯函数而不是 `createAppScope` 里的闭包：分组与取名每条分支的失效都是静默的
 * （同一账号报两次、名字取成别家店），要单测守着。
 */
import type { OtaCredential } from '../../shared/types/ota-credential';
import type { OtaCredentialExpiryScannedEvent } from '../../shared/browser';
import type { ScanTarget } from '../channels/inventory-scan-dispatcher';
import { channelAccountNameOf } from '../channels/bind-extra';
import { otaHotelNameOf } from '../channels/ota-hotel-name';

export function toCredentialExpirySummary(
  expired: readonly ScanTarget[],
  credentialByPartition: (partitionName: string) => OtaCredential | null,
): OtaCredentialExpiryScannedEvent {
  const byPartition = new Map<string, ScanTarget[]>();
  for (const target of expired) {
    const group = byPartition.get(target.partitionName);
    if (group) group.push(target);
    else byPartition.set(target.partitionName, [target]);
  }

  const accounts = [...byPartition.entries()].map(([partitionName, targets]) => {
    const channel = targets[0]?.channel ?? '';
    const credential = credentialByPartition(partitionName);
    const extra = credential?.credentialExtra ?? null;
    const hotelNames = targets
      .map((target) => otaHotelNameOf(target.channel, target.otaHotelId, extra))
      .filter((name): name is string => name !== null);
    return {
      channel,
      // 兜底到 partition 名：提醒里总得写点什么，空名字的提醒让人不知道该登哪个号。
      accountName:
        credential?.channelAccountName ??
        channelAccountNameOf(extra) ??
        credential?.channelAccountId ??
        partitionName,
      hotelNames: [...new Set(hotelNames)],
    };
  });

  return { accounts };
}
