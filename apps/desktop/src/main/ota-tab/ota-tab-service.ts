/**
 * OTA 标签页的唯一开口 —— 四个方法对应四种打开意图，各自决定用哪种 partition
 * 策略，然后调 `BrowserManager`。需要登录判定的意图会向 `LoginDetector` 登记。
 *
 * 「所有 OTA tab 都从这里打开」是本模块存在的意义：绕过它直接用
 * BrowserManager 开 tab 不会报错，只会静默地不触发账号探测。这条约束由
 * eslint `import/no-restricted-paths` 强制（services/ 不得 import browser/）。
 */
import { toOtaCredentialId, type ChannelId } from '../ids';
import type { OtaCredentialRepository } from '../repositories';
import { otaChannelLandingUrl } from '../channels/landing-url';
import { LEGACY_SHARED_PARTITION } from '../browser/partition';
import type { BrowserTab } from '../../shared/browser';
import { readImportedCookies } from '../cookie-import/store';
import { addPendingPartition, type PendingPartition } from '../file-store/pending-partitions-store';
import type { LoginDetector } from './login-detector';

/** 架构约束：不 import `browser-manager` 实现，用类型查询表达结构依赖。 */
type BrowserManagerTabOpener = Pick<
  import('../browser/browser-manager').BrowserManager,
  'createAndNewPartition' | 'createWithAlreadyPartition'
>;

export type OtaTabServiceDependencies = Readonly<{
  userDataDir: string;
  browserManager: BrowserManagerTabOpener;
  loginDetector: Pick<LoginDetector, 'register'>;
  otaCredentialRepository: Pick<OtaCredentialRepository, 'findById'>;
}>;

export class OtaTabService {
  constructor(private readonly deps: OtaTabServiceDependencies) {}

  /** "新建账号"：不注入 cookie，等待用户手动登录。 */
  async open(
    environment: PendingPartition['environment'],
    channel: ChannelId,
    url: string,
  ): Promise<BrowserTab> {
    const { tab, partitionName } = await this.deps.browserManager.createAndNewPartition(
      environment,
      channel,
      url,
    );
    this.deps.loginDetector.register(tab.id, channel);
    await this.rememberPendingPartition(partitionName, channel, environment);
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
    const imported = await readImportedCookies(this.deps.userDataDir, channel);
    if (!imported) throw new Error('该渠道尚未导入 Cookie');

    const { tab, partitionName } = await this.deps.browserManager.createAndNewPartition(
      environment,
      channel,
      url,
      { importedCookies: imported.cookies },
    );
    this.deps.loginDetector.register(tab.id, channel);
    await this.rememberPendingPartition(partitionName, channel, environment);
    return tab;
  }

  /**
   * 打开已有账号（流程B）。`intent` 目前只是类型占位（不消费具体语义），
   * 传入非 undefined 值即视为"这次打开需要登录判定"——具体 intent union
   * 由后续"酒店绑定探测流程"变更定义。不传维持现状行为：只开 tab，不判定。
   */
  openExisting(credentialId: string, intent?: unknown): BrowserTab {
    const credential = this.deps.otaCredentialRepository.findById(toOtaCredentialId(credentialId));
    if (!credential) throw new Error('未找到该登录凭据');
    const url = otaChannelLandingUrl(credential.channel);
    const tab = this.deps.browserManager.createWithAlreadyPartition(
      credential.partitionName,
      credential.channel,
      url,
    );
    if (intent !== undefined) this.deps.loginDetector.register(tab.id, credential.channel);
    return tab;
  }

  /** 查看渠道页面（原 `browser.create`），不参与登录判定。 */
  openView(channelId: string, url: string): BrowserTab {
    return this.deps.browserManager.createWithAlreadyPartition(
      LEGACY_SHARED_PARTITION,
      channelId,
      url,
    );
  }

  private rememberPendingPartition(
    partitionName: string,
    channel: ChannelId,
    environment: PendingPartition['environment'],
  ): Promise<void> {
    return addPendingPartition(this.deps.userDataDir, {
      partitionName,
      channel,
      environment,
      createdAt: new Date().toISOString(),
    });
  }
}
