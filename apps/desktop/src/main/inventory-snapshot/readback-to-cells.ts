/**
 * 把回读产出的上报体转成基线快照的格子 —— **装配层的粘合件**。
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
import type { OtaAmountChangeObserved } from '../../shared/types/amount-change';
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

/**
 * 从回读上报体里取出 cells 数组。
 *
 * 携程与美团的 payload 文件**刻意对齐了外层四个字段**（`trigger`/`probedAt`/`truncated`/
 * `cells`），所以这一步渠道无关 —— 加渠道不必改这里。
 */
export function readbackCellsOf(report: OtaAmountChangeObserved): readonly JsonObject[] {
  const cells = report.changeRaw.cells;
  if (!Array.isArray(cells)) return [];
  return cells.filter(
    (cell): cell is JsonObject =>
      typeof cell === 'object' && cell !== null && !Array.isArray(cell),
  );
}

/** 各渠道把原始 cell 行转成快照格子的函数。渠道差异全在它里面。 */
export type SnapshotCellMapper = (
  rows: readonly JsonObject[],
  otaHotelId: string,
  sourceOfTruth: SnapshotSourceOfTruth,
  observedAt: number,
) => readonly SnapshotCell[];

export type ReadbackSnapshotPersisterDependencies = Readonly<{
  /** 按渠道取 mapper。没注册的渠道直接跳过 —— 照 `inventoryReadbacks()` 的可选注册手法。 */
  mappers: ReadonlyMap<string, SnapshotCellMapper>;
  /** 查凭证。窄回调，由装配层接到 repository。 */
  credentialExtraByPartition: (partitionName: string) => JsonObject | null;
  /** 投递到写入队列。**同步入队，不等写库**。 */
  enqueue: (cells: readonly SnapshotCell[]) => void;
  logger: AppLogger;
  now?: () => number;
}>;

/**
 * 造一个「回读结果 → 基线快照」的投递函数，交给 `InventoryReadbackDispatcher.persistSnapshot`。
 *
 * 返回的函数**不抛错**（dispatcher 那边还有一层兜底，但不该依赖它）。
 */
export function createReadbackSnapshotPersister(
  deps: ReadbackSnapshotPersisterDependencies,
): (report: OtaAmountChangeObserved, partitionName: string) => void {
  const now = deps.now ?? (() => Date.now());

  return (report, partitionName) => {
    const mapper = deps.mappers.get(report.source);
    // 该渠道没接快照 —— 正常情况，不记日志（否则每次回读都刷一条噪音）。
    if (!mapper) return;

    const rows = readbackCellsOf(report);
    if (rows.length === 0) {
      // ⚠️ 与「渠道没接快照」不同，这是**接了但没拿到数据** —— 回读 ok 却没有 cells，
      // 要么该房型这些天确实没数据（合法），要么上报体形状变了（真问题）。
      // 两者在库里长得一样（都是没有 readback 行），不记日志就无从分辨。
      deps.logger.info('Snapshot skipped: readback returned no cells', {
        channel: report.source,
        endpointId: report.endpointId,
      });
      return;
    }

    const otaHotelId = masterHotelIdOf(deps.credentialExtraByPartition(partitionName));
    if (otaHotelId === null) {
      // ⚠️ 拒绝整批，不退回报文原值。见文件头。
      deps.logger.warn('Snapshot skipped: credential has no masterHotelId', {
        channel: report.source,
        endpointId: report.endpointId,
        droppedRows: rows.length,
      });
      return;
    }

    const cells = mapper(rows, otaHotelId, 'readback', now());
    if (cells.length === 0) {
      // 行有、格子没有 —— 说明每行都缺房型或日期，是形状问题，不是「确实没数据」。
      deps.logger.warn('Snapshot skipped: readback rows mapped to no cells', {
        channel: report.source,
        rows: rows.length,
      });
      return;
    }
    // ⚠️ 这条是判断「回读的 persist 支路有没有真的跑到」的唯一依据 —— 上报成功
    // **不代表** persist 也跑了，两者是并列的下游。少了它，库里没有 readback 行时
    // 分不清是「没跑」还是「跑了但被随后的 page-read 覆盖」。
    deps.logger.info('Snapshot enqueued from readback', {
      channel: report.source,
      cells: cells.length,
      otaHotelId,
      // ⚠️ 打出实际存了哪些格子 —— 只有键与 hash，不含 itemData（渠道原始行太大，
      // 且日志底层 util.inspect 超过 depth 会写成 [Object]，事后无法还原）。
      // 键 + hash 足以回答「存了什么」「与另一条路径写的是不是同一格」。
      keys: cells.map((c) => `${c.itemType}:${c.otaSaleRoomId}:${c.itemDate}=${c.contentHash}`),
    });
    deps.enqueue(cells);
  };
}


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
