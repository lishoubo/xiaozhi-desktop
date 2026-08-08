import { randomUUID } from 'node:crypto';
import { session, type Session } from 'electron';
import type { ChannelId } from '../ids';
import { toPartitionName } from '../browser/partition';
import { denyEmbeddedPagePermissions } from '../security/session-permissions';
import type { AppLogger } from '../../shared/logging';

const SERVER_API_PARTITION = 'persist:xiaozhi:server-api';
const RMS_API_PARTITION = 'persist:xiaozhi:rms-api';

/**
 * 把 partition 名字兑换成 Electron 的 `Session`。
 *
 * **这是全仓库唯一允许出现 partition 字符串的地方**（命名规则本身在
 * `browser/partition.ts`，那里可以裸测；这里只负责拿对象）。
 * 其他任何文件都不得调用 `session.fromPartition()` 或手工拼接 partition 名。
 */
export class SessionFactory {
  private readonly cache = new Map<string, Session>();

  constructor(private readonly logger: AppLogger) {}

  /** 已有 credential：直接用它的 `partitionName`，不重新拼接。 */
  sessionForAccount(partitionName: string): Session {
    return this.fromPartitionCached(partitionName);
  }

  /** Desktop backend API cookie jar, isolated from every OTA browsing session. */
  sessionForServerApi(): Session {
    return this.fromPartitionCached(SERVER_API_PARTITION);
  }

  /**
   * rms-server 直连用的 cookie jar，与 server API 和所有 OTA 浏览态都隔离。
   *
   * 认证本身走 Bearer token，用不上 cookie；但登录响应会带 `rms_current_hotel`，
   * 单独给它一个 jar 存着，后续接酒店上下文时不用再改这里。
   */
  sessionForRmsApi(): Session {
    return this.fromPartitionCached(RMS_API_PARTITION);
  }

  /**
   * 开一份新的登录态：短id 在此刻随机生成、创建后即固化（design.md 决策 3）。
   * 返回的 `partitionName` 是这份登录态唯一的权威指针，调用方必须原样保留——
   * 探测成功后要靠它落库 `OtaCredential.partitionName`。
   */
  sessionForLogin(
    environment: 'prod' | 'dev',
    channel: ChannelId,
  ): Readonly<{ session: Session; partitionName: string }> {
    const shortId = randomUUID().slice(0, 8);
    const partitionName = toPartitionName(environment, channel, shortId);
    this.logger.info('Login session created', { channel, environment });
    return { session: this.fromPartitionCached(partitionName), partitionName };
  }

  /**
   * 清空不再被 credential 引用的持久化 Session。调用方必须先确认没有标签
   * 使用该 partition；Electron 不提供删除 partition 目录的稳定 API，因此
   * 只通过公开 Session API 清理登录数据和缓存。
   */
  async clearAccountSession(partitionName: string): Promise<void> {
    const accountSession = this.fromPartitionCached(partitionName);
    await accountSession.closeAllConnections();
    await accountSession.clearStorageData();
    await accountSession.clearCache();
    this.cache.delete(partitionName);
  }

  private fromPartitionCached(partition: string): Session {
    const cached = this.cache.get(partition);
    if (cached) return cached;

    const created = session.fromPartition(partition);
    denyEmbeddedPagePermissions(created);
    this.cache.set(partition, created);
    return created;
  }

}
