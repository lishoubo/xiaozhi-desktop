import { session, type Session } from 'electron';
import type { BrowserContextKey } from '../../domain/identity';
import {
  isCurrentLayoutPartition,
  LEGACY_SHARED_PARTITION,
  toPartitionName,
} from '../../domain/policy/partition-policy';
import { denyEmbeddedPagePermissions } from '../security/session-permissions';
import type { AppLogger } from '../../shared/logging';

/**
 * 把领域层的 `BrowserContextKey` 兑换成 Electron 的 `Session`。
 *
 * **这是全仓库唯一允许出现 partition 字符串的地方**（命名规则本身在
 * `domain/policy/partition-policy.ts`，那里可以裸测；这里只负责拿对象）。
 * 其他任何文件都不得调用 `session.fromPartition()` 或手工拼接 partition 名。
 *
 * 每个 (environment, channel, otaAccountId) 一份独立存储 —— 这是 D1 的落地：
 * 同渠道的两个账号不再互相覆盖 cookie。
 */
export class SessionFactory {
  private readonly cache = new Map<string, Session>();

  constructor(private readonly logger: AppLogger) {}

  sessionFor(key: BrowserContextKey): Session {
    const partition = toPartitionName(key);
    const cached = this.cache.get(partition);
    if (cached) return cached;

    const created = session.fromPartition(partition);
    denyEmbeddedPagePermissions(created);
    this.cache.set(partition, created);
    this.logger.info('Browser session created', {
      channel: key.channel,
      otaAccountId: key.otaAccountId,
      environment: key.environment,
    });
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
