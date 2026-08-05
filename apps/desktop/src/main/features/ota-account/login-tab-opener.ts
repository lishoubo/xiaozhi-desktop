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
 *   注入已导入的 cookie；携程静默判定落地结果，抖音打开页面等待用户选公司
 */
import type { WebContents } from 'electron';
import { toChannelId, type ChannelId } from '../../../domain/identity';
import type { LoginUrlMatcher } from '../../../domain/ports/discovery';
import type { BrowserTab } from '../../../shared/browser';
import { readImportedCookies } from '../../cookie-import/store';
import {
  addPendingPartition,
  type PendingPartition,
} from '../../file-store/pending-partitions-store';

const CTRIP_CHANNEL_ID = toChannelId('ctrip');

export type LoginTabOpenerDependencies = Readonly<{
  userDataDir: string;
  browser: Pick<
    import('../../browser/browser-manager').BrowserManager,
    'createAndNewPartition'
  >;
  loginUrlMatchers: ReadonlyMap<ChannelId, LoginUrlMatcher>;
  /** 返回值：这次触发是否让某个 OtaAccount 完成了建号（携程静默判定需要）。 */
  triggerDiscovery: (
    partitionName: string,
    channel: ChannelId,
    landingUrl: string,
    webContents: WebContents,
  ) => Promise<boolean>;
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
      onUrlPastLogin: (boundPartitionName, landingUrl, webContents) => {
        void triggerDiscovery(boundPartitionName, channel, landingUrl, webContents);
      },
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

    if (channel === CTRIP_CHANNEL_ID) {
      // 携程：不等待用户交互，页面加载完成即静默判定（design.md 决策3）；
      // cookie 不删除，允许同一份 cookie 反复登录/重建（design.md §10.2）。
      const { tab, partitionName } = await browser.createAndNewPartition(environment, channel, url, {
        importedCookies: imported.cookies,
        onLoadFinished: (boundPartitionName, landingUrl, webContents) => {
          void triggerDiscovery(boundPartitionName, channel, landingUrl, webContents);
        },
      });
      await addPendingPartition(userDataDir, {
        partitionName,
        channel,
        environment,
        createdAt: new Date().toISOString(),
      });
      return tab;
    }

    // 抖音等其他渠道：注入 cookie 后打开可见页面，用户在页面内选择/切换
    // 公司，行为与 `open()` 一致，只是预注入了 cookie（design.md 决策4）。
    const { tab, partitionName } = await browser.createAndNewPartition(environment, channel, url, {
      importedCookies: imported.cookies,
      loginUrlMatcher: loginUrlMatchers.get(channel),
      onUrlPastLogin: (boundPartitionName, landingUrl, webContents) => {
        void triggerDiscovery(boundPartitionName, channel, landingUrl, webContents);
      },
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
