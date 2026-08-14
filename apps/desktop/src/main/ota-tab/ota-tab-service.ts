/**
 * OTA 标签页的唯一开口 —— 四个方法对应四种打开意图，各自决定用哪种 partition
 * 策略，然后调 `BrowserManager`。需要登录判定的意图会向 `LoginDetector` 登记。
 *
 * 「所有 OTA tab 都从这里打开」是本模块存在的意义：绕过它直接用
 * BrowserManager 开 tab 不会报错，只会静默地不触发账号探测。这条约束由
 * eslint `import/no-restricted-paths` 强制（services/ 不得 import browser/）。
 */
import { toOtaCredentialId, type ChannelId } from '../ids';
import type { OtaCredentialRepository } from '../database/ota-credential-repository';
import { otaChannelLandingUrl } from '../channels/landing-url';
import { bindingResetKeyPrefixes } from '../channels/binding-reset';
import type { BrowserTab } from '../../shared/browser';
import type { AppLogger } from '../../shared/logging';
import { readImportedCookies } from '../cookie-import/store';
import {
  recordPartitionCreated,
  type PendingPartition,
} from '../file-store/partition-ledger';
import type { LoginDetector } from './login-detector';
import type { OtaTabIntent } from './intent';

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
  /**
   * 在指定标签页里按前缀删 localStorage 键，返回被删的键名。
   *
   * 窄回调：本层不得 import `browser/`，由 composition root 接到 BrowserManager
   * 的页面脚本执行能力。绑定流程用它清掉渠道记住的「上次选的门店」。
   */
  removeSelectionKeys: (
    tabId: string,
    prefixes: readonly string[],
  ) => Promise<readonly string[] | null>;
  logger: AppLogger;
}>;

export class OtaTabService {
  constructor(private readonly deps: OtaTabServiceDependencies) {}

  /**
   * "新建账号"：不注入 cookie，等待用户手动登录。
   *
   * `intent` 与 `openExisting` 同义——「这次打开是为了做什么」。绑定入口的
   * 「新登录账号」快捷方式带 `bind-hotel` 意图走这条路：新账号可操作的门店未知，
   * 登录成功后必须探测并让用户确认。
   */
  async openForNewLogin(
    environment: PendingPartition['environment'],
    channel: ChannelId,
    url: string,
    intent?: OtaTabIntent,
  ): Promise<BrowserTab> {
    const { tab, partitionName } = await this.deps.browserManager.createAndNewPartition(
      environment,
      channel,
      url,
    );
    this.deps.loginDetector.register(tab.id, channel, intent);
    await this.rememberPendingPartition(partitionName, channel, environment);
    return tab;
  }

  /**
   * "登录账号"：要求该渠道已有导入好的 cookie（调用方负责在 UI 层用
   * `listImportedChannels` 判断该渠道是否已导入，这里没有 cookie 时直接
   * 报错，不静默退化为无 cookie 的新建登录）。携程与抖音均不消费/删除
   * 已导入的 cookie，允许反复登录/重建（design.md §10.2）。
   *
   * `intent` 与另外两个开口同义。缺了它，注入 cookie 这条路开出的标签页照样做
   * 登录判定，却永远不探测门店——绑定流程走这条路就会卡在「登录成功了但没有候选
   * 可选」。三个开口都收 intent，这一层才真正与渠道无关。
   */
  async openWithImportedCookie(
    environment: PendingPartition['environment'],
    channel: ChannelId,
    url: string,
    intent?: OtaTabIntent,
  ): Promise<BrowserTab> {
    const imported = await readImportedCookies(this.deps.userDataDir, channel);
    if (!imported) throw new Error('该渠道尚未导入 Cookie');

    const { tab, partitionName } = await this.deps.browserManager.createAndNewPartition(
      environment,
      channel,
      url,
      { importedCookies: imported.cookies },
    );
    this.deps.loginDetector.register(tab.id, channel, intent);
    await this.rememberPendingPartition(partitionName, channel, environment);
    return tab;
  }

  /**
   * 「用这个账号走一次绑定」——绑定流程专用。
   *
   * 与 `openExisting` 的差别只有一处：绑定要求用户**这一次**重新选门店，而渠道会
   * 记住上次的选择（抖音的 `core:PoiSwitch:*`），直接跳过选公司页落到上次那家门店
   * ——一个账号管多家门店时，第二家就绑不了了。所以开 tab 后要把那条记忆删掉。
   *
   * 此前的做法是**每次绑定新开一份 partition**、把 cookie 搬过去、把 localStorage
   * 甩掉。目的一样，代价是每绑一次泄漏一份 partition，且 cookie 搬运可能丢字段。
   * 现在复用原 partition + 按前缀删键：partition 零产出，cookie 一个字节不动。
   *
   * 方法名说的是**意图**（为绑定而打开）不是手段（换 partition / 删键）——手段这次
   * 就换过一轮，名字不该跟着作废。删哪些键由渠道自己声明，见 `binding-reset.ts`；
   * 没有声明的渠道（携程、美团都没有选店页）连脚本都不注入。
   */
  openExistingForBinding(credentialId: string, intent?: OtaTabIntent): BrowserTab {
    const credential = this.deps.otaCredentialRepository.findById(toOtaCredentialId(credentialId));
    if (!credential) throw new Error('未找到该登录凭据');

    const tab = this.deps.browserManager.createWithAlreadyPartition(
      credential.partitionName,
      credential.channel,
      otaChannelLandingUrl(credential.channel),
    );
    this.deps.loginDetector.register(tab.id, credential.channel, intent);
    void this.resetSelectionMemory(tab.id, credential.channel);
    return tab;
  }

  /**
   * 删掉渠道记住的「上次选的门店」。失败**不阻断绑定**：最坏结果是页面跳过选店页，
   * 用户看得见（停在了某家门店而不是选择页），比因为清理失败连标签页都开不出来强。
   */
  private async resetSelectionMemory(tabId: string, channel: ChannelId): Promise<void> {
    const prefixes = bindingResetKeyPrefixes(channel);
    if (prefixes.length === 0) return;

    try {
      const removed = await this.deps.removeSelectionKeys(tabId, prefixes);
      // 删了 0 个是**要警惕的信号**：键名可能被渠道改了，绑定会静默地跳过选店页。
      // 日志是唯一能指认这件事的线索，所以两种结果都记。
      this.deps.logger.info('Binding selection memory reset', {
        channel,
        removedCount: removed?.length ?? -1,
      });
    } catch (error) {
      this.deps.logger.warn('Binding selection memory could not be reset', {
        channel,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }

  openExisting(credentialId: string, intent?: OtaTabIntent): BrowserTab {
    const credential = this.deps.otaCredentialRepository.findById(toOtaCredentialId(credentialId));
    if (!credential) throw new Error('未找到该登录凭据');
    const url = otaChannelLandingUrl(credential.channel);
    const tab = this.deps.browserManager.createWithAlreadyPartition(
      credential.partitionName,
      credential.channel,
      url,
    );
    this.deps.loginDetector.register(tab.id, credential.channel, intent);
    return tab;
  }

  /** 登记进账本，状态 pending —— 探测成功后由 credential 侧改成 claimed。 */
  private rememberPendingPartition(
    partitionName: string,
    channel: ChannelId,
    environment: PendingPartition['environment'],
  ): Promise<void> {
    return recordPartitionCreated(this.deps.userDataDir, {
      partitionName,
      channel,
      environment,
      createdAt: new Date().toISOString(),
    });
  }
}
