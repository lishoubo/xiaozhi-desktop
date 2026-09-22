/**
 * 比对出的差异里，**哪些值得上报**。
 *
 * ## 为什么「变了」不等于「该报」
 *
 * 酒店有订单时房量本来就会变 —— 卖出一间，已售 +1、剩余 −1。旧判据把这类正常销售
 * 全当成「渠道侧发生了我们不知道的变更」报上去，真机观察到房量上报过于频繁，
 * 绝大多数是销售噪音。
 *
 * ```
 * snapshot-diff        变没变          渠道无关
 * 本文件               值不值得报      逻辑，仍渠道无关
 * quantity-reading     房量怎么算      渠道口径
 * ```
 *
 * ## 判据
 *
 * ```
 * 一格 changed
 *    │
 *    ├─ 价格格子 ───────────────────→ 上报（维持「变了就报」）
 *    │
 *    └─ 房态房量格子
 *          ├─ 房态字段变了 ─────────→ 上报
 *          └─ 否则看房量：
 *                ├─ 总房量与基线不同 ────────→ 上报
 *                ├─ 可售「非 0 → 0」跃迁 ────→ 上报
 *                └─ 其余 ───────────────────→ 不报
 * ```
 *
 * ## ⚠️ 售罄只报跃迁
 *
 * 售罄是**持续状态**。每轮都报会让同一格反复刷屏（携程库里 `canUsedQuantity = 0`
 * 的行有 203 条）。所以只在「上一轮不是售罄、这一轮是」的那一轮报；恢复有房后
 * 再次售罄会再报一次。
 *
 * ## ⚠️ 读不出房量时放行
 *
 * 渠道改字段导致 `total` 为 `null`，判据放行上报。失效方向朝**多报**而不是漏报 ——
 * 多报在服务端和日志里都看得见，漏报看不见。
 *
 * ## ⛔ 本模块不决定「报什么」
 *
 * 只决定发不发。报文结构与字段由 `scan-to-report.ts` 组装，仍是渠道原始行整行透传。
 */
import type { JsonObject } from '../../shared/types/json';
import type { SnapshotChange } from './snapshot-diff';
import type { QuantityReader } from './quantity-reading';

/**
 * 房态字段 —— 这些变了一律上报，不走房量判据。
 *
 * ⚠️ 与 `contentHash` 的字段集**有意分开**：那一组决定「变没变」（含房量字段），
 * 这一组决定「是不是房态变了」。混用会让房量变化也被当成房态变化，收窄失效。
 *
 * ⚠️ 美团的 `invSwitch`（房态开关）与 `roomStatus` 都算房态：实测关房时两者同时变
 * （`roomStatus` 1→0、`invSwitch` 1→0），只认一个会在渠道只改其中之一时漏报。
 */
const ROOM_STATUS_FIELDS: Readonly<Record<string, readonly string[]>> = {
  ctrip: ['roomStatus'],
  meituan: ['roomStatus', 'invSwitch'],
};

/** 房态字段有没有变。渠道没登记时返回 `false`，由调用方的兜底决定（见 `shouldReport`）。 */
function roomStatusChanged(source: string, latest: JsonObject, baseline: JsonObject): boolean {
  const fields = ROOM_STATUS_FIELDS[source];
  if (fields === undefined) return false;
  return fields.some((field) => String(latest[field] ?? '~') !== String(baseline[field] ?? '~'));
}

/**
 * 这一格该不该上报。
 *
 * @param readQuantity 该渠道的房量口径。**`undefined` 表示渠道没接判据** ——
 *        此时一律放行（回到「变了就报」），不因为没登记而静默漏报。
 */
export function shouldReport(
  change: SnapshotChange,
  readQuantity: QuantityReader | undefined,
): boolean {
  // 价格不在本次收窄范围内，维持既有行为。
  if (change.latest.itemType !== 'roomStatus') return true;

  // 渠道没登记房量口径 —— 放行，失效朝多报方向。
  if (readQuantity === undefined) return true;

  const latest = change.latest.itemData;
  const baseline = change.baseline.itemData;

  // 房态变了就报，不再看房量。
  if (roomStatusChanged(change.latest.source, latest, baseline)) return true;

  const latestQuantity = readQuantity(latest);
  const baselineQuantity = readQuantity(baseline);

  // ⚠️ 一侧算得出、另一侧算不出 —— 这是**限量/不限量模式切换**（或渠道改了字段），
  // 是实打实的经营动作，必须上报。
  //
  // 实测携程有 7 个房型出现过 `limitSale`/`freeSale` 组合变化。漏掉这条，
  // 「不限量 → 限量并设了 5 间」会被静默丢弃，而这正是要跟进的渠道事实。
  if ((latestQuantity.total === null) !== (baselineQuantity.total === null)) return true;

  // 两侧都算得出时才比数值。都为 null（持续不限量）时没有可比的总量，
  // 继续往下判售罄跃迁。
  if (
    latestQuantity.total !== null &&
    baselineQuantity.total !== null &&
    latestQuantity.total !== baselineQuantity.total
  ) {
    return true;
  }

  // ⚠️ 只报跃迁：上一轮不是售罄、这一轮是。已经是 0 且保持 0 的不重复报。
  if (latestQuantity.soldOut && !baselineQuantity.soldOut) return true;

  return false;
}
