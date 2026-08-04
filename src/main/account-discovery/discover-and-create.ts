/**
 * 探测层主流程：触发去重 → 执行探测 → 按 (channel, otaHotelId) 查重创建/更新
 * （design.md 决策 2、7、8）。
 *
 * 触发方只需要调 `DiscoverAndCreate.trigger(partitionName, channel)`，不用
 * 关心"这个 partition 是否已经探测过"——重复调用是安全的：
 *   - 探测进行中再次触发 → 用内存 Set 直接跳过（防重入）
 *   - 探测已经成功过一次（这个 partition 已经关联了 OtaAccount）→ 同样跳过，
 *     不重复创建 WebContentsView、不重复请求渠道接口（决策 8 的性能考量）
 */
import type { WebContents } from 'electron';
import type { ChannelId } from '../../domain/identity';
import { toOtaAccountId } from '../../domain/identity';
import type { OtaAccountRepository } from '../../domain/ports/repositories';
import type { AppLogger } from '../../shared/logging';
import type { DiscoveredOtaHotel, DiscoveryProbe } from './discovery-probe-port';

export type DiscoverAndCreateDependencies = Readonly<{
  probes: ReadonlyMap<ChannelId, DiscoveryProbe>;
  repository: OtaAccountRepository;
  generateAccountId: () => string;
  deleteSessionData: (partitionName: string) => Promise<void>;
  removePendingPartition: (partitionName: string) => Promise<void>;
  logger: AppLogger;
}>;

export class DiscoverAndCreate {
  private readonly inflight = new Set<string>();
  private readonly bound = new Set<string>();

  constructor(private readonly deps: DiscoverAndCreateDependencies) {}

  /**
   * 触发探测。幂等：同一个 partitionName 无论被调用多少次，最多真正执行一次
   * 探测；探测成功建/更新账号后，这个 partition 永久不再触发。
   *
   * `landingUrl` 是 URL 判定命中登录成功那一刻的完整 URL，`webContents` 是
   * 这个登录标签页本身（用户可见）的 WebContents 引用，原样透传给
   * `DiscoveryProbe.discover`——部分渠道（如抖音）需要在用户已登录、已经
   * 落在正确页面的这个真实标签页上直接读数据/模拟点击，而不是新开一个
   * 隐藏页面重新走一遍登录态（探测过必需的数据只在这个已渲染好的页面里
   * 才存在，新开页面拿不到）。
   */
  async trigger(
    partitionName: string,
    channel: ChannelId,
    landingUrl: string,
    webContents: WebContents,
  ): Promise<void> {
    if (this.bound.has(partitionName) || this.inflight.has(partitionName)) return;

    const probe = this.deps.probes.get(channel);
    if (!probe) {
      this.deps.logger.info('Discovery skipped: no probe registered for channel', { channel });
      return;
    }

    this.deps.logger.info('Discovery triggered', { channel, partitionName });
    this.inflight.add(partitionName);
    try {
      const outcome = await probe.discover(partitionName, landingUrl, webContents);
      this.deps.logger.info('Discovery outcome', { channel, kind: outcome.kind });
      switch (outcome.kind) {
        case 'unsupported':
        case 'none':
          return;
        case 'single':
          await this.createOrUpdate(partitionName, channel, outcome.hotel);
          this.bound.add(partitionName);
          this.deps.logger.info('Discovery bound OtaAccount', {
            channel,
            otaHotelId: outcome.hotel.otaHotelId,
          });
          return;
        case 'multiple':
          // design.md 决策 2：多门店需要用户选择，交由 renderer 侧确认后
          // 走独立入口创建账号（Task 6/7）。这里先不落库，也不标记 bound，
          // 允许用户确认前再次导航仍能重新探测到最新结果。
          this.deps.logger.info('Discovery found multiple hotels, awaiting user selection', {
            channel,
            count: outcome.hotels.length,
          });
          return;
      }
    } catch (error) {
      this.deps.logger.warn('Discovery failed', {
        channel,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    } finally {
      this.inflight.delete(partitionName);
    }
  }

  private async createOrUpdate(
    partitionName: string,
    channel: ChannelId,
    hotel: DiscoveredOtaHotel,
  ): Promise<void> {
    const { repository } = this.deps;
    const existing = repository.findByChannelAndHotelId(channel, hotel.otaHotelId);
    if (existing) {
      const previousPartitionName = existing.partitionName;
      repository.updatePartitionName(existing.id, partitionName);
      if (previousPartitionName !== partitionName) {
        await this.deleteOldPartitionSafely(previousPartitionName);
      }
    } else {
      repository.create({
        id: toOtaAccountId(this.deps.generateAccountId()),
        channel,
        otaHotelId: hotel.otaHotelId,
        otaHotelName: hotel.otaHotelName,
        partitionName,
      });
    }
    await this.deps.removePendingPartition(partitionName);
  }

  /**
   * 决策 7：删除失败不阻断账号更新——URL 触发场景下旧 partition 仍可能
   * 被另一个开着的标签页占用（决策 8），这不是异常路径。
   */
  private async deleteOldPartitionSafely(partitionName: string): Promise<void> {
    try {
      await this.deps.deleteSessionData(partitionName);
    } catch (error) {
      this.deps.logger.warn('Failed to delete stale partition session data', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }
}
