import { session, type Session } from 'electron';
import type { ChannelId } from '../../domain/identity';
import {
  isCurrentLayoutPartition,
  LEGACY_SHARED_PARTITION,
  toPartitionName,
} from '../../domain/policy/partition-policy';
import { denyEmbeddedPagePermissions } from '../security/session-permissions';
import type { AppLogger } from '../../shared/logging';

/**
 * 把 partition 名字兑换成 Electron 的 `Session`。
 *
 * **这是全仓库唯一允许出现 partition 字符串的地方**（命名规则本身在
 * `domain/policy/partition-policy.ts`，那里可以裸测；这里只负责拿对象）。
 * 其他任何文件都不得调用 `session.fromPartition()` 或手工拼接 partition 名。
 *
 * ⚠ 过渡态：`sessionForAccount`/`sessionForLogin` 的完整实现（登录标签页
 * 独立 partition + 已导入 cookie 预注入）在 Task 3 落地，这里先保证编译通过。
 */
export class SessionFactory {
  private readonly cache = new Map<string, Session>();

  constructor(private readonly logger: AppLogger) {}

  /** 已有账号：直接用它的 `OtaAccount.partitionName`，不重新拼接。 */
  sessionForAccount(partitionName: string): Session {
    return this.fromPartitionCached(partitionName);
  }

  /** 登录流程：environment + channel + 当场生成的短id，创建后即固化。 */
  sessionForLogin(environment: 'prod' | 'dev', channel: ChannelId, shortId: string): Session {
    const partition = toPartitionName(environment, channel, shortId);
    this.logger.info('Login session created', { channel, environment, shortId });
    return this.fromPartitionCached(partition);
  }

  private fromPartitionCached(partition: string): Session {
    const cached = this.cache.get(partition);
    if (cached) return cached;

    const created = session.fromPartition(partition);
    denyEmbeddedPagePermissions(created);
    this.cache.set(partition, created);
    return created;
  }

  /**
   * 旧的全局共享 session。**只读，不再写入。**
   *
   * 里面混着多个账号的登录态，无法判断哪条 cookie 属于谁 —— 自动迁移会把
   * A 的登录态错配给 B，所以保留但不迁移（磁盘最便宜，登录态最贵）。
   */
  legacySharedSession(): Session {
    return session.fromPartition(LEGACY_SHARED_PARTITION);
  }

  isLegacyPartition(name: string): boolean {
    return !isCurrentLayoutPartition(name);
  }
}
