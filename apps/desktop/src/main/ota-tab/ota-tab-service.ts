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

type CookiesSetDetails = import('electron').CookiesSetDetails;

export type OtaTabServiceDependencies = Readonly<{
  userDataDir: string;
  browserManager: BrowserManagerTabOpener;
  loginDetector: Pick<LoginDetector, 'register'>;
  otaCredentialRepository: Pick<OtaCredentialRepository, 'findById'>;
  /**
   * 读出一份登录态里可再注入的 cookie。由 composition root 接到
   * `SessionFactory.readInjectableCookies`——本层不得 import `browser/`。
   */
  readInjectableCookies: (partitionName: string) => Promise<readonly CookiesSetDetails[]>;
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
   * 「用这个账号走一次绑定」——绑定流程专用。开**一份新的 partition**，把账号原有
   * 的 cookie 注入进去。
   *
   * ## 为什么必须新建，而不是复用原 partition
   *
   * 绑定要求用户**这一次**重新选门店（一个抖音账号可管多家）。复用原 partition
   * 打开 `/p/login` 会直接落到上次那家门店，用户没有选择机会。
   *
   * 2026-08-14 用 CDP 逐层排查过，**本地存储不是原因**，三条路全部实测无效：
   *
   * | 试过的做法 | 实测结果 |
   * |---|---|
   * | 删 localStorage 的 `core:PoiSwitch:*` 键 | ❌ 日志确认删掉了（`removedCount: 1`），页面照样跳。该键是页面落地后**抄下来的结果**，不是原因 |
   * | 清 Service Worker（`clearStorageData` 与 `clearData` 两种 API 都试过） | ❌ 用 `Network.setBypassServiceWorker` 绕开 SW 后照样跳 —— SW 只是缓存了本来就会发生的跳转 |
   * | 拦掉页面自身的跳转，停在 `/p/login` | ❌ 停住后该页无可见内容，它只是中转页，选公司页不在这个地址上 |
   *
   * 真正的原因在**服务端**：`/p/login` 的页面脚本先调 `/passport/account/info/v2/`，
   * 从响应里拿到「这个会话上次用的 life_account_id」，然后自己跳过去（CDP 实测
   * `reason=scriptInitiated`，全程 HTTP 200 无 302）。这份记忆绑在登录会话上，
   * 清任何本地存储都动不了它。
   *
   * 新建 partition 之所以有效：注入的 cookie 与原会话并不完全等价
   * （`readInjectableCookies` 搬不动 session cookie 等），抖音因此不认得「上次那家」，
   * 只好重新问。**它是靠这个差异生效的**，不是我们主动控制的机制 —— 抖音若改了判定，
   * 这条路会再次失效；届时请从上面的排查结论重新找入口，**不要再试一遍那三条**。
   *
   * ## 代价与它的归宿
   *
   * 每次绑定留下一份新 partition。`e977c06` 当年记的是「已知代价，partition 生命周期
   * 治理另行处理」——那件事已经做完：这里创建的 partition 会登记进 `partitions.json`
   * 账本（`pending`），认领后转 `claimed`，没被认领的由启动清理当孤儿回收。
   */
  async openExistingForBinding(
    environment: PendingPartition['environment'],
    credentialId: string,
    intent?: OtaTabIntent,
  ): Promise<BrowserTab> {
    const credential = this.deps.otaCredentialRepository.findById(toOtaCredentialId(credentialId));
    if (!credential) throw new Error('未找到该登录凭据');

    const cookies = await this.deps.readInjectableCookies(credential.partitionName);
    const { tab, partitionName } = await this.deps.browserManager.createAndNewPartition(
      environment,
      credential.channel,
      otaChannelLandingUrl(credential.channel),
      { importedCookies: cookies },
    );
    this.deps.loginDetector.register(tab.id, credential.channel, intent);
    // 登记进账本：这正是 e977c06 当年欠下、本轮补上的那一环。
    await this.rememberPendingPartition(partitionName, credential.channel, environment);
    return tab;
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
