/**
 * 把「刚取回的最新数据」与「本地基线」逐格比对，产出差异。
 *
 * ## ⚠️ 本模块在 Change A 只建不接线
 *
 * 消费它的是定时扫描（Change B，`add-ota-inventory-scan`）。放在 Change A 是因为它与
 * `SnapshotCell` 的形状强耦合，跟类型定义放在一起才能一起演化；而且它是**纯函数**，
 * 不依赖调度、取数与上报，可以先写完测透。
 *
 * ## 三类结果，`unchanged` 不在返回值里
 *
 * ```
 * changed    基线里有，且 contentHash 不同   → 上报
 * added      基线里没有                      → ⚠️ 不上报，见下
 * unchanged  基线里有且一致                  → 不返回（返回它只会让调用方过滤一遍）
 * ```
 *
 * ## ⚠️ `added` 必须与 `changed` 分开，不可合并上报
 *
 * 基线里没有这一格，**不代表渠道刚刚新增了它**，更可能是我们从没读过这一格：自然读只覆盖
 * 用户实际翻到的日期与房型，基线天然稀疏。
 *
 * 把 `added` 当成变更上报，会在首次扫描时把整个窗口当成「渠道全变了」灌给服务端。所以
 * 调用方对 `added` 的正确处置是**只写基线、不上报**（首次建基线）。这条规则写在这里而不是
 * 只写在调用方，是因为一旦有人把两者合并，失效方式是「服务端收到一大批不存在的变更」，
 * 而本地日志看起来一切正常。
 *
 * ## 不做「删除」判定
 *
 * 基线里有、最新数据里没有的格子**不产出任何结果**。原因：取数范围由日期窗口与房型范围
 * 决定，窗口外或本次没取的格子必然「缺席」，把缺席判成删除会误报一大片。真正的删除
 * （房型下架）由基线的过期清理处理，不走比对。
 *
 * ## ⚠️ `changed` 带上基线格子，`added` 不带
 *
 * 「变了没有」只需要比 `contentHash`，但**「怎么变的」需要旧值** —— 房量判据要回答
 * 「总房量变了吗」「可售是不是刚从非 0 变成 0」，这两个问题都得拿新旧两个数字比。
 *
 * ⛔ **不能从 `contentHash` 反解旧值**：它是固定字段按顺序拼的字符串，拆不回
 * 「`limitRemain` 当时是几」。所以旧格子必须原样交给调用方。
 *
 * `added` 不带基线是因为它的定义就是「基线里没有」—— 没有旧值可言。这也是判据对两者
 * 处置不同的根据：`added` 只写基线不上报，压根不进判据。
 */
import type { SnapshotCell } from './types';
import { snapshotKeyOf } from './types';

/**
 * 一格的变化：新值 + 它在基线里的旧值。
 *
 * ⚠️ `baseline` **必有** —— `changed` 的定义就是「基线里有且 `contentHash` 不同」。
 * 类型上不做可空，调用方不必写 `if (baseline)` 这种永远为真的分支。
 */
export type SnapshotChange = Readonly<{
  latest: SnapshotCell;
  baseline: SnapshotCell;
}>;

export type SnapshotDiff = Readonly<{
  /**
   * 基线里有，但内容变了 —— 这些才是「渠道侧发生了我们不知道的变更」。
   *
   * ⚠️ **「变了」不等于「该上报」**：房量会因正常销售持续变动（卖出一间 → 已售 +1、
   * 剩余 −1），这类变化不构成需要跟进的渠道事实。是否上报由上报判据决定，本模块
   * 只负责「变没变」，不含任何渠道知识。
   */
  changed: readonly SnapshotChange[];
  /** 基线里没有 —— ⚠️ 只写基线，**不上报**。见文件头。 */
  added: readonly SnapshotCell[];
}>;

/**
 * @param latest   刚从渠道取回的格子
 * @param baseline 本地基线（通常来自 `findByHotelAndDateRange`）
 *
 * ⚠️ 比 `contentHash` 而非 `itemData` 的 JSON 字符串：后者含渠道噪音（回显参数、内部
 * 时间戳）与不稳定的键序，会让没变的格子被判成有差异。
 */
export function diffSnapshots(
  latest: readonly SnapshotCell[],
  baseline: readonly SnapshotCell[],
): SnapshotDiff {
  const baselineByKey = new Map(baseline.map((cell) => [snapshotKeyOf(cell), cell]));

  const changed: SnapshotChange[] = [];
  const added: SnapshotCell[] = [];

  for (const cell of latest) {
    const previous = baselineByKey.get(snapshotKeyOf(cell));
    if (previous === undefined) {
      added.push(cell);
      continue;
    }
    if (previous.contentHash !== cell.contentHash) {
      changed.push({ latest: cell, baseline: previous });
    }
  }

  return { changed, added };
}
