/**
 * cookie 快照采集编排：CDP 优先，不可用则降级到 Electron API。
 *
 * ```
 * collectCookieSnapshot(partitionName)
 *        │
 *        ├─ webContentsForPartition(partitionName)   找该账号开着的标签页
 *        │        │
 *        │        ▼
 *        ├─ collectViaCdp()          ok  ──────────────►  完整快照（含 CHIPS 分区键）
 *        │        │
 *        │        └─ 不可用（no-tab / debugger-busy / attach-failed / command-failed）
 *        │                 │
 *        │                 ▼
 *        └─ collectViaElectronSession()  ────────────►  降级快照（缺 partitionKey）
 *                                                        + warn 日志留痕
 *                          │
 *                          ▼
 *              toSnapshotEntry()  两条路共用的省略规则
 * ```
 *
 * **降级不让业务失败**：绑定 / 重新登录 / 补门店三条流程都在收尾阶段调用这里，
 * 此刻远端可能已经写入成功，抛错只会把用户卡在一个其实已完成的操作上。降级快照
 * 虽缺分区键，但补齐了 `expires` 等属性，显著优于改造前的三字段快照。
 */
import type { Session, WebContents } from 'electron';
import type { AppLogger } from '../../../shared/logging';
import type { RmsCookieSnapshotEntry } from '../../gateway/rms/types';
import { collectViaCdp, type CdpUnavailableReason } from './cdp-source';
import { collectViaElectronSession } from './electron-source';
import { toSnapshotEntry } from './to-snapshot-entry';

export type CollectCookieSnapshotDeps = Readonly<{
  partitionName: string;
  /** 该 partition 的 Electron Session，降级路径用。 */
  session: Session;
  /** 按 partition 反查标签页 webContents；没有标签页时返回 null。 */
  webContentsForPartition: (partitionName: string) => WebContents | null;
  logger: AppLogger;
}>;

/**
 * 采集一份可上送的 cookie 快照。
 *
 * ⚠️ 日志只记**元信息**（条数、采集方式、降级原因），绝不记任何 cookie 的 name→value
 * 对应关系 —— 快照是登录凭证本身，落进日志等于把登录态写到磁盘上。
 */
export async function collectCookieSnapshot(
  deps: CollectCookieSnapshotDeps,
): Promise<readonly RmsCookieSnapshotEntry[]> {
  const { partitionName, session, webContentsForPartition, logger } = deps;

  const webContents = webContentsForPartition(partitionName);
  const viaCdp = await collectViaCdp(webContents, logger);

  if (viaCdp.ok) {
    const entries = viaCdp.cookies.map((cookie) => toSnapshotEntry(cookie, 'cdp'));
    logger.info('Cookie snapshot collected', {
      source: 'cdp',
      count: entries.length,
      // 分区 cookie 条数是这次改造的核心指标：为 0 说明要么该账号确实没有分区
      // cookie，要么采集出了问题 —— 服务端核验对不上时先看这个数。
      partitionedCount: entries.filter((entry) => entry.partitionKey !== undefined).length,
    });
    return entries;
  }

  /**
   * 降级路径自己也可能失败（Session 已随 partition 退休销毁、cookie 存储读盘出错）。
   *
   * **不吞掉**：吞了就得上送一份空快照，而空快照会把远端**已有的、可用的**登录态
   * 覆盖成空 —— 那比让这次操作失败严重得多（远端从此拿不到任何 cookie，86 家门店
   * 一起掉线，且没有任何错误提示）。这里让它抛，调用方停在「绑定失败」，用户重试
   * 即可，远端数据不受损。
   *
   * 这与「采集能力受限时不让流程失败」不矛盾：那条规则针对的是**拿不到分区键**
   * 这类质量降级，不是「一条 cookie 都读不到」这种彻底失败。
   */
  const cookies = await collectViaElectronSession(session);
  const entries = cookies.map((cookie) => toSnapshotEntry(cookie, 'electron'));

  /**
   * 降级必须留痕：降级快照与完整快照在服务端看来只差分区 cookie 条数，没有这条日志
   * 就无法区分「客户端没改造」和「本次采集降级了」。用 warn 而非 info，是因为常态
   * 应该走 CDP —— 这条日志频繁出现本身就是需要处理的信号（见 design Open Questions）。
   */
  logger.warn('Cookie snapshot degraded: collected without partition keys', {
    source: 'electron-session',
    degraded: true,
    reason: viaCdp.reason satisfies CdpUnavailableReason,
    count: entries.length,
  });

  return entries;
}
