/**
 * 扫描结果 → 比对基线 → 差异上报体。**装配层的粘合件**。
 *
 * ```
 * 调度器取回原始行
 *      ↓ 本模块
 *   ① 行 → 格子（渠道映射）
 *   ② 读基线 + diff + 写入   ← ⚠️ 这三步之间不得 await
 *   ③ changed 组上报体（added 只写不报）
 *      ↓
 *   上报服务
 * ```
 *
 * ## ⚠️ 为什么②的三步之间不能 await
 *
 * 取数要走数秒网络，期间用户可能改了价并触发回读，基线随之更新。若「读基线」与「写入」
 * 之间再插入等待，窗口会拉长到整轮扫描时长，把**用户自己的改动**误报成外部变更。
 *
 * 取数完成后一次性读基线、比对、写入，窗口被压到几毫秒 —— 这是本方案不追求严格一致性
 * 的前提：不需要版本号、时间戳护栏或锁。
 *
 * ## ⚠️ `added` 只写不报
 *
 * 基线天然稀疏（自然读只覆盖用户实际翻到的范围）。把「没读过」当成「渠道新增了」，
 * 会在首次扫描时把整个窗口灌给服务端。判定在 `snapshot-diff.ts`，这里只是不绕过它。
 */
import type { AppLogger } from '../../shared/logging';
import type { JsonObject } from '../../shared/types/json';
import type { OtaAmountChangeObserved } from '../../shared/types/amount-change';
import { diffSnapshots } from './snapshot-diff';
import type { SnapshotCell, SnapshotCellMapper } from './types';

/** 读一批基线。窄回调，由装配层接到 repository。 */
export type ReadBaseline = (
  source: string,
  otaHotelId: string,
  startDate: string,
  endDate: string,
) => readonly SnapshotCell[];

/** 组上报体。渠道差异全在它里面（`endpointId`、`endpointUrl`、外层形状）。 */
export type ScanReportBuilder = (
  otaHotelId: string,
  cells: readonly JsonObject[],
  probedAt: string,
) => OtaAmountChangeObserved;

export type ScanResultHandlerDependencies = Readonly<{
  /** 按渠道取行→格子映射。没注册的渠道跳过。 */
  mappers: ReadonlyMap<string, SnapshotCellMapper>;
  /** 按渠道取上报体组装函数。 */
  reportBuilders: ReadonlyMap<string, ScanReportBuilder>;
  readBaseline: ReadBaseline;
  /** 投递写入队列。**同步入队，不等写库**。 */
  enqueue: (cells: readonly SnapshotCell[]) => void;
  /** 差异上报。窄回调，由装配层接到上报服务。 */
  report: (observed: OtaAmountChangeObserved, partitionName: string) => void;
  logger: AppLogger;
  now?: () => number;
}>;

export type ScanResultTarget = Readonly<{
  channel: string;
  partitionName: string;
  otaHotelId: string;
}>;

/**
 * 造一个「扫描结果 → 比对 → 上报」的处理函数，交给 `InventoryScanDispatcher.onRows`。
 *
 * 返回的函数**同步执行且不抛错** —— 调度层不该因为比对出问题而中断整轮。
 */
export function createScanResultHandler(
  deps: ScanResultHandlerDependencies,
): (target: ScanResultTarget, rows: readonly JsonObject[]) => void {
  const now = deps.now ?? (() => Date.now());

  return (target, rows) => {
    const mapper = deps.mappers.get(target.channel);
    const buildReport = deps.reportBuilders.get(target.channel);
    // 该渠道没接快照/上报 —— 正常情况，不记日志。
    if (!mapper || !buildReport) return;

    const observedAt = now();
    const latest = mapper(rows, target.otaHotelId, 'scan', observedAt);
    if (latest.length === 0) {
      // 取回的行映射不出任何格子。空结果是合法的（这些天确实没数据），
      // 但也可能是渠道改了字段 —— 记一条 info 便于事后分辨。
      deps.logger.info('Inventory scan produced no cells', {
        channel: target.channel,
        otaHotelId: target.otaHotelId,
        rows: rows.length,
      });
      return;
    }

    // ⚠️ 以下到 enqueue 为止**不得出现 await** —— 见文件头。
    const dates = latest.map((cell) => cell.itemDate).sort();
    const baseline = deps.readBaseline(
      target.channel,
      target.otaHotelId,
      dates[0] ?? '',
      dates[dates.length - 1] ?? '',
    );
    const { changed, added } = diffSnapshots(latest, baseline);

    // 无论变没变都要写：未变的格子刷新 observedAt，让「这格是什么时候确认过的」有据可查。
    deps.enqueue(latest);

    deps.logger.info('Inventory scan compared', {
      channel: target.channel,
      otaHotelId: target.otaHotelId,
      cells: latest.length,
      baseline: baseline.length,
      changed: changed.length,
      // ⚠️ added 只写基线不上报 —— 首次见到的格子不是「渠道新增了」。
      addedBaseline: added.length,
    });

    if (changed.length === 0) return;

    deps.report(
      buildReport(
        target.otaHotelId,
        changed.map((cell) => cell.itemData),
        new Date(observedAt).toISOString(),
      ),
      target.partitionName,
    );
  };
}
