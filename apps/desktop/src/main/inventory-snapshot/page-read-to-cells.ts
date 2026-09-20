/**
 * 把自然读拦截到的渠道原始行转成基线快照的格子 —— **装配层的粘合件**。
 *
 * ## 为什么需要这一层，而不是让渠道实现直接产出格子
 *
 * 快照的 `otaHotelId` 必须取自**登录凭证**（见下），而凭证在 `database/` 里，
 * `channels/` 被 eslint 禁止访问它。所以：
 *
 * ```
 * channels/  产出 cells（渠道语义），otaHotelId 留空
 *     ↓ 装配层注入
 * 本模块     补齐 otaHotelId（查凭证）→ 转成 SnapshotCell → 投递队列
 * ```
 *
 * 与既有 `AmountChangeReportService.resolveOtaHotelId()` 同一手法、同一口径 ——
 * 那一层也是在 service 里补的，渠道实现只管留空。
 *
 * ## ⚠️ 回读不走这里
 *
 * 回读发的请求会被改价监听的 CDP 拦到（真机实证），于是它的数据本来就由自然读这条路
 * 落库，且自然读还多产价格格子。详见 `channels/inventory-readback-dispatcher.ts` 文件头。
 *
 * ## ⚠️ 与既有上报的一处**刻意不同**：取不到 masterHotelId 时拒绝写入
 *
 * 既有上报的处置是「保留报文原值照发」，理由是「一个可能对不上的 ID 仍比没有 ID 更有
 * 反查价值」——上报是**一次性**的，服务端反查不到就丢弃，代价有限。
 *
 * 基线不是一次性的：
 *
 * ```
 * 存错的 otaHotelId → 这格永久留在库里
 *                   → 下次归一正确时，同一格变成「另一家酒店」的格子
 *                   → 唯一键撞不上 → 库里同时存在两份基线
 *                   → 定时扫描拿正确的那份去比，把整批判成「新增」
 * ```
 *
 * 所以这里**宁可少一格基线，不留脏数据**。少一格的代价是「这格下次被观测到时重建」，
 * 而脏数据的代价是持续误报。
 */
import type { JsonObject } from '../../shared/types/json';
import type { AppLogger } from '../../shared/logging';
import type { SnapshotCell, SnapshotSourceOfTruth } from './types';

/**
 * 从凭证的 `credentialExtra` 里取归一用的门店 ID。
 *
 * 与 `AmountChangeReportService.resolveOtaHotelId()` 同一取值逻辑（数字或非空字符串），
 * 但**不做「取不到就回退原值」** —— 见文件头。
 */
export function masterHotelIdOf(credentialExtra: JsonObject | null): string | null {
  if (credentialExtra === null) return null;
  const raw = credentialExtra.masterHotelId;
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim();
  return null;
}

/** 各渠道把原始 cell 行转成快照格子的函数。渠道差异全在它里面。 */
export type SnapshotCellMapper = (
  rows: readonly JsonObject[],
  otaHotelId: string,
  sourceOfTruth: SnapshotSourceOfTruth,
  observedAt: number,
) => readonly SnapshotCell[];

export type PageReadSnapshotPersisterDependencies = Readonly<{
  /** 按渠道取 mapper。没注册的渠道直接跳过。 */
  mappers: ReadonlyMap<string, SnapshotCellMapper>;
  credentialExtraByPartition: (partitionName: string) => JsonObject | null;
  enqueue: (cells: readonly SnapshotCell[]) => void;
  logger: AppLogger;
  now?: () => number;
}>;

/**
 * 造一个「自然读结果 → 基线快照」的投递函数，交给 `AmountChangeWatcher.onReadRows`。
 *
 * 与回读那个的唯一差别是 `sourceOfTruth` 与入参形状（这里直接拿到行，不用从上报体里挖）
 * —— 归一口径、拒绝脏数据的规则完全一致，所以共用 `masterHotelIdOf`。
 *
 * ⚠️ 自然读覆盖面**随用户翻到哪儿**，天然稀疏。这不是缺陷：基线本就是「我们见过什么」，
 * 没见过的格子由 Change B 的「无基线只写不报」规则兜住。
 */
export function createPageReadSnapshotPersister(
  deps: PageReadSnapshotPersisterDependencies,
): (channel: string, endpointId: string, rows: readonly JsonObject[], partitionName: string) => void {
  const now = deps.now ?? (() => Date.now());

  return (channel, endpointId, rows, partitionName) => {
    const mapper = deps.mappers.get(channel);
    if (!mapper || rows.length === 0) return;

    const otaHotelId = masterHotelIdOf(deps.credentialExtraByPartition(partitionName));
    if (otaHotelId === null) {
      // 与回读同一处置：拒绝整批，不退回报文原值。见文件头。
      deps.logger.warn('Snapshot skipped: credential has no masterHotelId', {
        channel,
        endpointId,
        droppedRows: rows.length,
      });
      return;
    }

    const cells = mapper(rows, otaHotelId, 'page-read', now());
    if (cells.length === 0) return;
    // 与回读那条对称 —— 两条路径打同样的键，才能直接对比是不是同一批格子。
    deps.logger.info('Snapshot enqueued from page-read', {
      channel,
      endpointId,
      cells: cells.length,
      otaHotelId,
      keys: cells.map((c) => `${c.itemType}:${c.otaSaleRoomId}:${c.itemDate}=${c.contentHash}`),
    });
    deps.enqueue(cells);
  };
}
