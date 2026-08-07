/**
 * OTA 标签页打开的统一入口。取代原 `main/features/ota-credential/login-tab-opener.ts`
 * 的 `LoginTabOpener`，同时补齐它没覆盖的"打开已有账号"（`openExisting`）和
 * "查看渠道页面"（`openView`）两个场景，四个方法一一对应 `BrowserManager`
 * 的开 tab 能力，是本次重构收拢的唯一收口点。
 *
 * `BrowserManager` 只广播原始导航/关闭事实（`tab:navigated`/`tab:closed`），
 * 不理解"登录判定"这个概念——这个概念完全收在这里：`loginTabs` 记录哪些
 * tab 正在等待登录判定（`openExisting` 传了 `intent` 时也算），订阅
 * `tab:navigated` 时查表判定、去重、触发账号身份探测（`triggerDiscovery`），
 * 结果通过 `tabEventBus` 广播 `tab:credential-checked`，语义与重构前完全
 * 一致——`OtaHotelProbFeature` 无需感知这次重构。
 *
 * 时序约束（历史踩坑，见 `split-ota-hotel-prob-feature` 变更记录，必须保留）：
 * `tab:credential-checked` 必须等 `triggerDiscovery` 写库完成才广播，不能在
 * 导航发生的那一刻广播——否则 `OtaHotelProbFeature` 可能查到 null 而永久
 * 错过探测机会（携程场景下标签页只导航一次，没有第二次机会）。
 */
import type { WebContents } from 'electron';
import { toOtaCredentialId, type ChannelId } from '../../../domain/identity';
import type { LoginUrlMatcher } from '../../../domain/ports/discovery';
import type { OtaCredential } from '../../../domain/ota-credential';
import type { OtaCredentialRepository } from '../../../domain/ports/repositories';
import { otaChannelLandingUrl } from '../../../domain/policy/ota-channel-landing-url-policy';
import { LEGACY_SHARED_PARTITION } from '../../../domain/policy/partition-policy';
import type { BrowserTab } from '../../../shared/browser';
import { readImportedCookies } from '../../cookie-import/store';
import {
  addPendingPartition,
  type PendingPartition,
} from '../../file-store/pending-partitions-store';
import { TabEventBus } from '../../browser/tab-event-bus';

/** 架构约束：不 import `browser-manager` 实现，用类型查询表达结构依赖。 */
type TabNavigatedEvent = import('../../browser/browser-manager').TabNavigatedEvent;
type TabClosedEvent = import('../../browser/browser-manager').TabClosedEvent;

type LoginTabState = Readonly<{
  channel: ChannelId;
  loginUrlMatcher: LoginUrlMatcher;
}>;

export type OtaTabOpenerDependencies = Readonly<{
  userDataDir: string;
  browserManager: Pick<
    import('../../browser/browser-manager').BrowserManager,
    'on' | 'createAndNewPartition' | 'createWithAlreadyPartition'
  >;
  tabEventBus: TabEventBus;
  loginUrlMatchers: ReadonlyMap<ChannelId, LoginUrlMatcher>;
  otaCredentialRepository: Pick<OtaCredentialRepository, 'findById'>;
  /**
   * 返回值：这次触发最终确认的 OtaCredential（没有则为 null）。写库完成后
   * 才返回，`OtaTabOpener` 据此决定何时广播 `tab:credential-checked`。
   */
  triggerDiscovery: (
    partitionName: string,
    channel: ChannelId,
    landingUrl: string,
    webContents: WebContents,
  ) => Promise<OtaCredential | null>;
}>;

export class OtaTabOpener {
  private readonly loginTabs = new Map<string, LoginTabState>();
  private readonly triggered = new Set<string>();

  constructor(private readonly deps: OtaTabOpenerDependencies) {
    this.deps.browserManager.on('tab:navigated', (event: TabNavigatedEvent) => {
      void this.handleTabNavigated(event);
    });
    this.deps.browserManager.on('tab:closed', (event: TabClosedEvent) => {
      this.loginTabs.delete(event.tabId);
      this.triggered.delete(event.tabId);
    });
  }

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
    this.registerLoginTab(tab.id, channel);
    await addPendingPartition(this.deps.userDataDir, {
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
    const imported = await readImportedCookies(this.deps.userDataDir, channel);
    if (!imported) throw new Error('该渠道尚未导入 Cookie');

    const { tab, partitionName } = await this.deps.browserManager.createAndNewPartition(
      environment,
      channel,
      url,
      { importedCookies: imported.cookies },
    );
    this.registerLoginTab(tab.id, channel);
    await addPendingPartition(this.deps.userDataDir, {
      partitionName,
      channel,
      environment,
      createdAt: new Date().toISOString(),
    });
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
    if (intent !== undefined) this.registerLoginTab(tab.id, credential.channel);
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

  private registerLoginTab(tabId: string, channel: ChannelId): void {
    const loginUrlMatcher = this.deps.loginUrlMatchers.get(channel);
    if (!loginUrlMatcher) return;
    this.loginTabs.set(tabId, { channel, loginUrlMatcher });
  }

  private async handleTabNavigated(event: TabNavigatedEvent): Promise<void> {
    const state = this.loginTabs.get(event.tabId);
    const baseEvent = {
      tabId: event.tabId,
      partitionName: event.partitionName,
      channel: event.channelId,
      url: event.url,
      webContents: event.webContents,
    };

    if (!state || this.triggered.has(event.tabId)) {
      this.deps.tabEventBus.emitCredentialChecked({
        ...baseEvent,
        outcome: { kind: 'not-applicable' },
      });
      return;
    }

    const isPastLogin = state.loginUrlMatcher.isPastLogin(event.url);
    if (!isPastLogin) {
      this.deps.tabEventBus.emitCredentialChecked({
        ...baseEvent,
        outcome: { kind: 'not-yet-past-login' },
      });
      return;
    }

    this.triggered.add(event.tabId);
    const credential = await this.deps.triggerDiscovery(
      event.partitionName,
      state.channel,
      event.url,
      event.webContents,
    );
    this.deps.tabEventBus.emitCredentialChecked({
      ...baseEvent,
      outcome: { kind: 'checked', credential },
    });
  }
}
