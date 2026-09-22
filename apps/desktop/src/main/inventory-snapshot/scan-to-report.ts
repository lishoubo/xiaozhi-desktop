/**
 * 扫描结果 → 比对基线 → 差异上报体。**装配层的粘合件**。
 *
 * ```
 * 调度器取回原始行
 *      ↓ 本模块
 *   ① 行 → 格子（渠道映射）
 *   ② 读基线 + diff + 写入   ← ⚠️ 这三步之间不得 await
 *   ③ 基线够新吗？不够 → 只写不报（见下）
 *   ④ changed 过判据 → 组上报体（added 只写不报）
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
 *
 * ## ⚠️ 基线太旧时也只写不报
 *
 * 同一条理由的时间维度版：**基线太旧 ≈ 没有基线**。关着应用过了一夜再打开，整批价格
 * 都跟昨天不同 —— 那是这一夜里陆续变的，不是此刻的事件（真机实测：隔 17 小时的基线，
 * 一个门店一次报了 205 条）。
 *
 * 上次比对时刻按**渠道 × 门店**记在内存里，阈值见 `app-config` 的 `baselineFreshnessMs`。
 * 代价是**每次启动必然漏掉一次对账**，取舍与理由见那边的注释。
 */
import type { AppLogger } from '../../shared/logging';
import type { JsonObject } from '../../shared/types/json';
import type { OtaAmountChangeObserved } from '../../shared/types/amount-change';
import { diffSnapshots } from './snapshot-diff';
import { shouldReport } from './inventory-report-gate';
import type { QuantityReader } from './quantity-reading';
import type { SnapshotCell, SnapshotCellMapper } from './types';

/** `YYYY-MM-DD`，取本地日期 —— 渠道的「今天」是营业日，不是 UTC 日。 */
function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 本轮扫描的日期区间（闭区间）。与 `channels/ctrip/inventory-scan.ts` 算请求窗口
 * 同一口径：自今日起算，`windowDays` 含今天，所以末日是 `+(windowDays - 1)`。
 *
 * ⚠️ 两处必须一致：查基线的区间比请求的窄，会让窗口尾部的格子每轮都当成「首次见到」
 * 只写不报，差异永远报不出来。
 */
function scanWindow(today: Date, windowDays: number): readonly [string, string] {
  const end = new Date(today);
  end.setDate(end.getDate() + Math.max(0, windowDays - 1));
  return [toDateKey(today), toDateKey(end)];
}

/** 读一批基线。窄回调，由装配层接到 repository。 */
export type ReadBaseline = (
  source: string,
  otaHotelId: string,
  startDate: string,
  endDate: string,
) => readonly SnapshotCell[];

/** 组上报体。渠道差异全在它里面（`endpointId`、`endpointUrl`、外层形状）。 */
/**
 * 上报的 cell 里标注「这一格是什么」的字段名。
 *
 * 取值就是 `SnapshotItemType`（`roomStatus` | `price`）—— 基线库里的同一维度，
 * 字段名也与库保持一致。服务端据它分派 cell 的解析方式，不必靠字段特征反推。
 *
 * ⚠️ 不带 `__` 前缀：两个渠道的真实响应里都没有 `itemType` 字段，不会撞名；
 * 与库同名让「库里那一维」和「报文里这个字段」是同一个概念，对接时不必翻译。
 * 将来若有渠道返回同名字段，冲突会体现在这里 —— 那时再改名，别默默让它被覆盖。
 */
export const ITEM_TYPE_FIELD = 'itemType';

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
  /**
   * 按渠道取房量口径，供上报判据用。
   *
   * ⚠️ **没注册的渠道一律按「变了就报」放行**（见 `inventory-report-gate.ts`）——
   * 漏注册的后果是多报，不是漏报。漏报在日志上看不出来。
   */
  quantityReaders: ReadonlyMap<string, QuantityReader>;
  readBaseline: ReadBaseline;
  /** 投递写入队列。**同步入队，不等写库**。 */
  enqueue: (cells: readonly SnapshotCell[]) => void;
  /** 差异上报。窄回调，由装配层接到上报服务。 */
  report: (observed: OtaAmountChangeObserved, partitionName: string) => void;
  logger: AppLogger;
  /** 链路 ID 生成器。注入而非直接 `randomUUID()`，是为了让测试能断言 ID 的流向。 */
  newTraceId: () => string;
  /**
   * 基线新鲜度上限（毫秒）。窄回调而非取值，因为配置可热更新 —— 取值会把启动那一刻的
   * 值钉死。语义见 `app-config/types.ts` 的 `baselineFreshnessMs`。
   */
  baselineFreshnessMs: () => number;
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
): (target: ScanResultTarget, rows: readonly JsonObject[], windowDays: number) => void {
  const now = deps.now ?? (() => Date.now());

  /**
   * 每个「渠道 × 门店」上次**成功比对**的时刻。
   *
   * ⚠️ **按门店分开记，不能用一个全局值**：四个扫描目标独立调度，某个门店可能因为
   * 登录失效连续几轮扫不到，而其他三个正常 —— 全局值会让那个门店搭便车，
   * 拿着几小时前的基线照常比对。
   *
   * ⚠️ **只在内存里，重启即丢**。这是有意的：重启意味着中断过，那一轮的基线年龄
   * 不可信，丢失记录正好让启动后首轮自动跳过，不必再写一套「上次时间是不是太久」的判断。
   */
  const lastComparedAt = new Map<string, number>();

  return (target, rows, windowDays) => {
    const mapper = deps.mappers.get(target.channel);
    const buildReport = deps.reportBuilders.get(target.channel);
    // 该渠道没接快照/上报 —— 正常情况，不记日志。
    if (!mapper || !buildReport) return;

    // ⚠️ 链路 ID 在**这一轮这个门店的起点**生成，此后每条日志都带上它，最终作为
    // `operationId` 发给 RMS —— 于是「取数 → 比对 → 上报 → RMS 台账」是同一个 ID。
    // 不这么做的话，一轮扫描打出来的几条日志之间没有任何字段能串起来，
    // 排查时只能靠时间戳猜是不是同一轮（而四个门店的扫描只隔几百毫秒）。
    const traceId = deps.newTraceId();
    const observedAt = now();
    const latest = mapper(rows, target.otaHotelId, 'scan', observedAt);
    if (latest.length === 0) {
      // 取回的行映射不出任何格子。空结果是合法的（这些天确实没数据），
      // 但也可能是渠道改了字段 —— 记一条 info 便于事后分辨。
      deps.logger.info('Inventory scan produced no cells', {
        traceId,
        channel: target.channel,
        otaHotelId: target.otaHotelId,
        rows: rows.length,
      });
      return;
    }

    // ⚠️ 以下到 enqueue 为止**不得出现 await** —— 见文件头。
    // 区间用**本轮请求的窗口**，不从返回数据反推 min/max：那样查询范围会随渠道
    // 返回了什么而漂移，「这一轮到底比了哪些天」对不上账。
    const [startDate, endDate] = scanWindow(new Date(observedAt), windowDays);
    const baseline = deps.readBaseline(target.channel, target.otaHotelId, startDate, endDate);
    const { changed, added } = diffSnapshots(latest, baseline);

    // 无论变没变都要写：未变的格子刷新 observedAt，让「这格是什么时候确认过的」有据可查。
    deps.enqueue(latest);

    // ⚠️ 基线太旧时**只写不报** —— 旧基线与现状的差异不代表「渠道刚刚变了」，
    // 只代表「这段时间我们没在看」。与 `added` 的处置同一条理由（见 `snapshot-diff.ts`）。
    //
    // ⚠️ 位置在 `enqueue` **之后**：跳过的是「比对与上报」，不是「写基线」——
    // 不写的话下一轮拿到的还是旧基线，会永远跳过。
    const targetKey = `${target.channel}\u0000${target.otaHotelId}`;
    const previousComparedAt = lastComparedAt.get(targetKey);
    const baselineAgeMs =
      previousComparedAt === undefined ? undefined : observedAt - previousComparedAt;
    const freshnessMs = deps.baselineFreshnessMs();

    // ⚠️ 无论走哪条路都要更新时刻 —— 跳过时不更新的话，下一轮（`idleMs` 后）算出来的
    // 年龄仍然超限，于是**连续跳过、再也不比对**。
    lastComparedAt.set(targetKey, observedAt);

    if (baselineAgeMs === undefined || baselineAgeMs > freshnessMs) {
      deps.logger.info('Inventory scan skipped diff: baseline not fresh', {
        traceId,
        channel: target.channel,
        otaHotelId: target.otaHotelId,
        cells: latest.length,
        // 两种原因含义不同：`first-round` 每次启动都会有（预期内）；
        // `stale` 说明运行期间断档过（睡眠 / 断网 / 渠道连续失败），值得注意。
        reason: baselineAgeMs === undefined ? 'first-round' : 'stale',
        baselineAgeMs: baselineAgeMs ?? null,
        freshnessMs,
      });
      return;
    }

    // ⚠️ **「变了」不等于「该报」**：房量会因正常销售持续变动（卖出一间 → 已售 +1、
    // 剩余 −1），这类噪音不上报。房态与价格维持「变了就报」。判据见
    // `inventory-report-gate.ts`，渠道房量口径见 `quantity-reading.ts`。
    const quantityReader = deps.quantityReaders.get(target.channel);
    const reportable = changed.filter((change) => shouldReport(change, quantityReader));

    // ⚠️ **不打基线总数**（`baseline.length`）。它是「窗口内库里有多少格」，包含本轮
    // 压根没取的格子 —— 自然读会写入扫描范围之外的东西（例如钟点房商品，扫描侧按
    // `roomCategory` 滤掉，自然读照页面返回全收）。拿它和 `cells` 对照会得出
    // 「差了 N 格、是不是漏扫了」这种不存在的结论，而比对本身以 `latest` 为准，
    // 基线里多出来的格子不参与任何判断（见 `snapshot-diff.ts`「不做删除判定」）。
    //
    // 三个数字自洽即可：`compared + 首次见到的 = cells`。
    // ⚠️ `changed` 与 `reported` **按 itemType 拆开**。只打两个总数的话，
    // 「changed 211 → reported 205」这种数字完全看不出判据有没有生效 ——
    // 价格不收窄、房量才收窄，两类混在一个数里就分不出滤掉的是什么。
    const countByType = (cells: readonly { itemType: string }[]) => ({
      roomStatus: cells.filter((c) => c.itemType === 'roomStatus').length,
      price: cells.filter((c) => c.itemType === 'price').length,
    });

    deps.logger.info('Inventory scan compared', {
      traceId,
      channel: target.channel,
      otaHotelId: target.otaHotelId,
      cells: latest.length,
      // 本轮读到的格子里，有多少在基线里找到了对照。
      compared: latest.length - added.length,
      changed: countByType(changed.map((c) => c.latest)),
      reported: countByType(reportable.map((c) => c.latest)),
      // 被判据滤掉的房量噪音 —— 这个数字大就说明收窄正在起作用。
      suppressed: changed.length - reportable.length,
    });

    if (reportable.length === 0) return;

    deps.report(
      {
        ...buildReport(
          target.otaHotelId,
          // ⚠️ 每个 cell 带上 `itemType`（房态房量 / 价格）—— 基线库里本就有这一维，
          // 只发 `itemData` 等于把它丢掉，逼服务端靠字段猜（「有 salePrice 就是价格」）。
          //
          // 携程两类格子共用同一个 roomTypeID，猜错代价有限；**美团是两个 ID 空间**
          // （房态房量挂 roomId，价格挂 goodsId），猜错就会把价格当成房态、拿 goodsId
          // 去查物理房型 —— 查不到，或更糟：查到一个同号的别的房型。
          reportable.map(({ latest: cell }) => ({
            ...cell.itemData,
            [ITEM_TYPE_FIELD]: cell.itemType,
          })),
          new Date(observedAt).toISOString(),
        ),
        // service 层据此复用为 operationId —— 见 `amount-change-report-service.ts`。
        traceId,
      },
      target.partitionName,
    );
  };
}
