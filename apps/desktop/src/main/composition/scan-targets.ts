/**
 * 一个凭证展开成几个扫描目标 —— **枚举口径按渠道不同**。
 *
 * ```
 * 携程   凭证 ──────────────► 1 个目标    otaHotelId = credentialExtra.masterHotelId
 *        （门店上下文完全由 cookie 决定，一个凭证天然对应它当前所在那家店）
 *
 * 美团   凭证 ──┬── 门店 A               ⚠️ 美团没有 masterHotelId
 *               ├── 门店 B               取自 credentialExtra.pois（登录时探测写入）
 *               └── 门店 C
 * ```
 *
 * ## ⚠️ 美团为什么不查 `ota_hotel`
 *
 * `ota_hotel` 存的是**绑定关系**（用户当场确认过是哪家店），而扫描要的是**取数入参**
 * （这个账号能看到哪些店）。两者同源但语义不同：
 *
 * ```
 * ota_hotel                 用户确认过的绑定      ← 绑定流程写
 * credentialExtra.pois      账号名下的门店清单    ← 登录时探测写（见 meituan/discovery.ts）
 * ```
 *
 * 走绑定关系的话，用户登录了却没绑店就什么都不扫 —— 而美团登录后本来就能静默取到
 * 门店清单，让用户再手点一次绑定没有意义。
 *
 * ⚠️ 其余三条链路（改价上报、回读、自然读）的 `otaHotelId` 都**从报文里取**
 * —— 用户的操作本身带着「他在哪家店」这个上下文。只有扫描由定时器触发，没有报文，
 * 所以才需要登录时记下来。
 *
 * 两条路都遵守同一条底线：**归一用的 ID 取不到就跳过，不写脏基线**。存错的
 * `otaHotelId` 会永久留在库里，下次归一正确时同一格变成「另一家酒店」，唯一键撞不上
 * → 两份基线 → 扫描把整批判成新增。
 *
 * ## ⚠️ 为什么是独立模块而不是装配层的闭包
 *
 * 它是**领域判断**（哪些目标该扫、门店 ID 从哪来），不是装配细节。写成 `createAppScope`
 * 里的闭包就够不到，只能靠真机验证 —— 而这里每条分支的失效方式都是静默的
 * （少扫一家店、或把格子写到别家店头上），正是最需要测试守着的那类。
 */
import type { ChannelId } from '../ids';
import type { AppLogger } from '../../shared/logging';
import type { OtaCredential } from '../../shared/types/ota-credential';
import type { JsonObject } from '../../shared/types/json';
import type { ScanTarget } from '../channels/inventory-scan-dispatcher';
import { masterHotelIdOf } from '../inventory-snapshot/page-read-to-cells';
import { MEITUAN_POIS_FIELD } from '../channels/meituan/poi-infos';

export type ScanTargetsDependencies = Readonly<{
  meituanChannel: ChannelId;
  logger: AppLogger;
}>;

/** `credentialExtra.pois` 里的一条。形状由 `meituan/poi-infos.ts` 的 `toPoiEntries` 产出。 */
function poiEntriesOf(credentialExtra: JsonObject | null): readonly JsonObject[] {
  if (credentialExtra === null) return [];
  const pois = credentialExtra[MEITUAN_POIS_FIELD];
  if (!Array.isArray(pois)) return [];
  return pois.filter(
    (poi): poi is JsonObject => typeof poi === 'object' && poi !== null && !Array.isArray(poi),
  );
}

/** 取字符串字段，空值一律 `null`。 */
function textOf(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  return null;
}

export function createScanTargetsOf(
  deps: ScanTargetsDependencies,
): (channel: ChannelId, credential: OtaCredential) => readonly ScanTarget[] {
  return (channel, credential) => {
    if (channel === deps.meituanChannel) {
      const pois = poiEntriesOf(credential.credentialExtra);
      if (pois.length === 0) {
        // ⚠️ 记一条：这个凭证一个请求都不发，与「调度器挂了」在日志上长得一样。
        // 成因通常是登录时 poiInfos 没取到（或这条凭证建于本功能之前），
        // 重新登录一次即可。不是异常，所以是 info。
        deps.logger.info('Inventory scan: meituan credential has no poi list, skipped', {
          partitionName: credential.partitionName,
        });
        return [];
      }

      const targets: ScanTarget[] = [];
      for (const poi of pois) {
        const poiId = textOf(poi.poiId);
        const otaPartnerId = textOf(poi.otaPartnerId);
        if (poiId === null || otaPartnerId === null) {
          // 缺任一个都取不了数。⚠️ 不能拿 credentialExtra 外层那个 partnerId 去凑 ——
          // 那是**账号级**的，与门店级不是一个值。
          deps.logger.warn('Inventory scan: meituan poi entry incomplete, skipped', {
            poiId,
            hasPartnerId: otaPartnerId !== null,
          });
          continue;
        }
        targets.push({
          channel,
          partitionName: credential.partitionName,
          otaHotelId: poiId,
          // ⚠️ poiId 同时出现在两处，不是冗余：`otaHotelId` 是**通用维度**（基线的门店
          // 键、上报的归一 ID），`channelExtra.otaHotelId` 是**渠道取数入参**（美团三个
          // 端点都要显式传 poiId）。渠道实现只认后者。
          channelExtra: { otaHotelId: poiId, otaPartnerId },
        });
      }
      return targets;
    }

    const otaHotelId = masterHotelIdOf(credential.credentialExtra);
    if (otaHotelId === null) return [];
    return [{ channel, partitionName: credential.partitionName, otaHotelId, channelExtra: {} }];
  };
}
