/**
 * "去登录"编排（流程A）：读该渠道已导入的 cookie → 新建 partition 打开
 * 登录标签页（挂上该渠道的 LoginUrlMatcher，URL 判定登录成功时触发探测，
 * 见 design.md 决策 8）→ 记一条待认领 partition。三步顺序固定、互相依赖
 * 前一步的输出（partitionName 生成前不存在），因此不拆分给不同调用方，
 * 也不写进 IPC handler 本体——参照 docs/arch/2026-08-03-final-architecture.md
 * §3.6 LoginHealthChecker 的先例：编排放 main/features/，判定/纯逻辑放 domain/。
 *
 * 流程B（打开已有账号）不走这里，见 docs/arch/2026-08-03-login-tab-flows.md。
 */
import type { WebContents } from 'electron';
import type { ChannelId } from '../../../domain/identity';
import type { LoginUrlMatcher } from '../../../domain/ports/discovery';
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
  triggerDiscovery: (
    partitionName: string,
    channel: ChannelId,
    landingUrl: string,
    webContents: WebContents,
  ) => void;
}>;

export class LoginTabOpener {
  constructor(private readonly deps: LoginTabOpenerDependencies) {}

  async open(
    environment: PendingPartition['environment'],
    channel: ChannelId,
    url: string,
  ): Promise<BrowserTab> {
    const { userDataDir, browser, loginUrlMatchers, triggerDiscovery } = this.deps;
    const imported = await readImportedCookies(userDataDir, channel);
    const { tab, partitionName } = await browser.createAndNewPartition(environment, channel, url, {
      importedCookies: imported?.cookies,
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
