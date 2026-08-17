import { randomUUID } from 'node:crypto';
import { session, type CookiesSetDetails, type Session } from 'electron';
import type { ChannelId } from '../ids';
import { toPartitionName } from '../browser/partition';
import { denyEmbeddedPagePermissions } from '../security/session-permissions';
import type { AppLogger } from '../../shared/logging';

const SERVER_API_PARTITION = 'persist:xiaozhi:server-api';
const RMS_API_PARTITION = 'persist:xiaozhi:rms-api';

/**
 * 把 partition 名字兑换成 Electron 的 `Session`，并保证它的安全配置已就位。
 *
 * **这是全仓库唯一允许出现 partition 字符串的地方**（命名规则本身在
 * `browser/partition.ts`，那里可以裸测；这里负责拿对象 + 装安全 handler）。
 * 其他任何文件都不得调用 `session.fromPartition()` 或手工拼接 partition 名。
 *
 * ⚠️ 本类**不管理 Session 的生命周期**——Electron 全局持有 Session、且不提供销毁
 * API，我们能做的只有 `clearAccountSession()` 清空其存储内容。partition 目录本身
 * 永远留在磁盘上。
 */
export class SessionFactory {
  /**
   * 已经装过安全 handler 的 partition。
   *
   * **不是对象池**：`session.fromPartition()` 对同名永远返回同一个 Session，
   * 对象由 Electron 全局持有，缓存它没有意义（此前这里是 `Map<string, Session>`，
   * 类型上像个池子，读代码的人会以为它管着 Session 的生命周期）。
   *
   * 它的唯一职责是幂等：`denyEmbeddedPagePermissions` 用的两个 setter 是**覆盖式**
   * 的，同一个 Session 上装第二遍会替换掉第一遍。虽然两次装的是同一个「全部拒绝」、
   * 重复无害，但「已配置过就别再配」本身是有意义的约束。
   *
   * **不需要淘汰**：一旦装过，这个事实在整个进程生命周期内都为真（Session 对象
   * 不会被销毁，handler 一直挂着）。条目只增不减是正确行为，不是泄漏 —— 它只占
   * 一个字符串，真正的 Session 对象无论如何都在 Electron 手里。
   */
  private readonly configuredPartitions = new Set<string>();

  constructor(private readonly logger: AppLogger) {}

  /** 已有 credential：直接用它的 `partitionName`，不重新拼接。 */
  sessionForAccount(partitionName: string): Session {
    return this.configuredSession(partitionName);
  }

  /** Desktop backend API cookie jar, isolated from every OTA browsing session. */
  sessionForServerApi(): Session {
    return this.configuredSession(SERVER_API_PARTITION);
  }

  /**
   * rms-server 直连用的 cookie jar，与 server API 和所有 OTA 浏览态都隔离。
   *
   * 认证本身走 Bearer token，用不上 cookie；但登录响应会带 `rms_current_hotel`，
   * 单独给它一个 jar 存着，后续接酒店上下文时不用再改这里。
   */
  sessionForRmsApi(): Session {
    return this.configuredSession(RMS_API_PARTITION);
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
    return { session: this.configuredSession(partitionName), partitionName };
  }

  /**
   * 把一份登录态的 cookie 读成**可再注入**的形状。
   *
   * 与 `readCookieSnapshot`（发给 RMS 的 `{domain,name,value}`）不是一回事：那份是
   * 给远端看的摘要，缺了 `url`/`path`/`secure` 等字段，塞不回 `cookies.set`。这里
   * 保留注入所需的全部字段，供「换一份干净 partition 重开同一个账号」使用。
   *
   * `url` 由 domain 反推：`cookies.set` 必须要它，而 `cookies.get` 不返回。前导点是
   * domain 通配写法，不属于主机名，拼 URL 前要去掉。
   */
  async readInjectableCookies(partitionName: string): Promise<readonly CookiesSetDetails[]> {
    const accountSession = this.configuredSession(partitionName);
    const cookies = await accountSession.cookies.get({});
    return cookies.map((cookie) => {
      const host = cookie.domain?.replace(/^\./, '') ?? '';
      return {
        url: `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path ?? '/'}`,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        expirationDate: cookie.expirationDate,
        sameSite: cookie.sameSite,
      };
    });
  }

  /**
   * 清空不再被 credential 引用的持久化 Session。调用方必须先确认没有标签
   * 使用该 partition；Electron 不提供删除 partition 目录的稳定 API，因此
   * 只通过公开 Session API 清理登录数据和缓存。
   */
  async clearAccountSession(partitionName: string): Promise<void> {
    const accountSession = this.configuredSession(partitionName);
    await accountSession.closeAllConnections();
    await accountSession.clearStorageData();
    await accountSession.clearCache();
    // 刻意**不**从 configuredPartitions 移除：清空存储不销毁 Session 对象
    // （Electron 没有销毁 API），安全 handler 仍然挂着。撤销标记只会让下次访问
    // 重复装一遍 handler。
  }

  /**
   * 拿到 Session，并保证它的安全 handler 已装好（只装一次）。
   *
   * 「拿对象」这件事本身不需要我们缓存 —— Electron 保证同名同对象。这里做的是
   * 「首次见到这个 partition 时补上安全配置」。
   */
  private configuredSession(partition: string): Session {
    const target = session.fromPartition(partition);
    if (this.configuredPartitions.has(partition)) return target;

    denyEmbeddedPagePermissions(target);
    this.configuredPartitions.add(partition);
    return target;
  }
}
