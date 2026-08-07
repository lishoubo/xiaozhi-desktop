/**
 * "去登录"编排：新建 partition 打开登录标签页（挂上该渠道的
 * LoginUrlMatcher，URL 判定登录成功时触发探测，见 design.md 决策 8）→
 * 记一条待认领 partition。参照 docs/arch/2026-08-03-final-architecture.md
 * §3.6 LoginHealthChecker 的先例：编排放 main/features/，判定/纯逻辑放
 * domain/。
 *
 * 流程B（打开已有账号）不走这里，见 docs/arch/2026-08-03-login-tab-flows.md。
 *
 * 两个方法对应两个不同的 UI 入口（add-account-flow-per-channel/design.md
 * §10）：
 * - `open()`：添加账号面板"新建账号"，不注入 cookie，等待用户手动登录
 * - `createFromCookie()`：设置页"已登录 Cookie 列表"里的"登录账号"，
 *   注入已导入的 cookie；所有渠道统一走 `loginUrlMatcher` 判定登录结果——
 *   携程 cookie 有效会直接跳出登录页、失效会被重定向回登录页，跟其他渠道
 *   同一套 URL 判据即可覆盖，不需要单独的"页面加载完成即判定"通道
 *   （历史上有过 `onLoadFinished` 专用路径，因为不经过 `checkUrlPastLogin`
 *   / `TabEventBus` 广播，酒店探测会被静默跳过，已删除）
 */
import type { WebContents } from 'electron';
import type { ChannelId } from '../../../domain/identity';
import type { LoginUrlMatcher } from '../../../domain/ports/discovery';
import type { OtaCredential } from '../../../domain/ota-credential';
import type { BrowserTab } from '../../../shared/browser';
import { readImportedCookies } from '../../cookie-import/store';
import {
  addPendingPartition,
  type PendingPartition,
} from '../../file-store/pending-partitions-store';

export type LoginTabOpenerDependencies = Readonly<{
  userDataDir: string;
  browser: Pick<
    import('../../browser/browser-manager').BrowserManager,
    'createAndNewPartition'
  >;
  loginUrlMatchers: ReadonlyMap<ChannelId, LoginUrlMatcher>;
  /**
   * 返回值：这次触发最终确认的 OtaCredential（没有则为 null）。
   * `open()`/`createFromCookie()` 把这个返回值原样透传给 `BrowserManager`，
   * 由它在 credential 真正写入数据库之后才广播
   * `tab:credential-checked`（见 `main/browser/tab-event-bus.ts`）。
   */
  triggerDiscovery: (
    partitionName: string,
    channel: ChannelId,
    landingUrl: string,
    webContents: WebContents,
  ) => Promise<OtaCredential | null>;
}>;

export class LoginTabOpener {
  constructor(private readonly deps: LoginTabOpenerDependencies) {}

  async open(
    environment: PendingPartition['environment'],
    channel: ChannelId,
    url: string,
  ): Promise<BrowserTab> {
    const { userDataDir, browser, loginUrlMatchers, triggerDiscovery } = this.deps;
    const { tab, partitionName } = await browser.createAndNewPartition(environment, channel, url, {
      loginUrlMatcher: loginUrlMatchers.get(channel),
      onUrlPastLogin: (boundPartitionName, landingUrl, webContents) =>
        triggerDiscovery(boundPartitionName, channel, landingUrl, webContents),
    });
    await addPendingPartition(userDataDir, {
      partitionName,
      channel,
      environment,
      createdAt: new Date().toISOString(),
    });
    return tab;
  }

  /**
   * "登录账号"：要求该渠道已有导入好的 cookie（调用方负责在 UI 层用
   * `listImportedChannels` 判断该渠道是否已导入，这里没有 cookie 时直接
   * 报错，不静默退化为无 cookie 的新建登录）。携程与抖音均不消费/删除
   * 已导入的 cookie，允许反复登录/重建（design.md §10.2）。
   */
  async createFromCookie(
    environment: PendingPartition['environment'],
    channel: ChannelId,
    url: string,
  ): Promise<BrowserTab> {
    const { userDataDir, browser, loginUrlMatchers, triggerDiscovery } = this.deps;
    const imported = await readImportedCookies(userDataDir, channel);
    if (!imported) throw new Error('该渠道尚未导入 Cookie');

    // 注入 cookie 后打开页面，用 loginUrlMatcher 判定是否已跳出登录页
    // （cookie 有效直接落地、失效被重定向回登录页，携程与抖音同一判据）；
    // cookie 不删除，允许同一份 cookie 反复登录/重建（design.md §10.2）。
    const { tab, partitionName } = await browser.createAndNewPartition(environment, channel, url, {
      importedCookies: imported.cookies,
      loginUrlMatcher: loginUrlMatchers.get(channel),
      onUrlPastLogin: (boundPartitionName, landingUrl, webContents) =>
        triggerDiscovery(boundPartitionName, channel, landingUrl, webContents),
    });
    await addPendingPartition(userDataDir, {
      partitionName,
      channel,
      environment,
      createdAt: new Date().toISOString(),
    });
    return tab;
  }
}
