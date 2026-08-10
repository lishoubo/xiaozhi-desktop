/**
 * 重新登录的**身份核对**：订阅标签页事实 → 比对登录出来的账号是不是用户选的那个
 * → 把结论送回 UI。
 *
 * 与 `HotelProbeDispatcher` 是并列的兄弟订阅者，各认各的 intent kind，互不感知。
 * 事件总线本来就是多订阅者模型，加第三种流程同样只加订阅者，不动既有的。
 *
 * **为什么必须核对**：`LoginDetector` 只判断 URL 离开了登录页，「登录判定完成」不
 * 等于「登录的还是原来那个账号」——浏览器里可能残留别的登录态，用户也可能手滑登错。
 * 不核对就把新 cookie 写上去，等于把账号 B 的登录态更新到账号 A 的那条绑定上：远端
 * 状态还会变成正常，实际却指向另一个账号，比原来的「过期」更糟且不报错。
 *
 * **为什么不需要 probe**：身份识别已经在 `triggerDiscovery` 里做完了（各渠道的
 * `account-identity.ts`），结果就在事件带的 `credential.channelAccountId` 上，直接
 * 读即可。再探一次既重复又要多操作一次页面。
 *
 * 读 cookie 与调远端都**不在这里**：`channels/` 不认识 session 与 gateway（eslint
 * 禁止），那些推迟到用户看到结果之后的 `confirmReauth`（service 层）。
 */
import type { AppLogger } from '../../shared/logging';
import type { TabCredentialCheckedEvent, TabEventBus } from '../ota-tab';
import type { UiWaitingResultEnvelope } from '../../shared/types/ui-waiting-result-types';

export type OtaReauthDispatcherDependencies = Readonly<{
  tabEventBus: TabEventBus;
  logger: AppLogger;
  /** 同 `HotelProbeDispatcher`：窄回调，composition root 接到 `webContents.send`。 */
  notify: (envelope: UiWaitingResultEnvelope) => void;
}>;

export class OtaReauthDispatcher {
  constructor(private readonly deps: OtaReauthDispatcherDependencies) {
    this.deps.tabEventBus.on('tab:credential-checked', (event: TabCredentialCheckedEvent) => {
      this.onCredentialChecked(event);
    });
  }

  private onCredentialChecked(event: TabCredentialCheckedEvent): void {
    if (event.intent?.kind !== 'reauth-ota') return;
    if (event.outcome.kind !== 'checked') return;

    const { requestId, expectedChannelAccountId } = event.intent;
    const { credential } = event.outcome;

    // 标签页已经关了说明用户已放弃。
    if (event.webContents.isDestroyed()) {
      this.deps.logger.info('Reauth result discarded: tab closed', { requestId });
      return;
    }

    // 拿不到身份就**不放行**。这里宁可让用户走「新登录账号」重新绑定，也不赌——
    // 赌错的代价是一条指向错误账号的绑定，而且不报错。
    const actual = credential === null ? null : credential.channelAccountId;
    if (credential === null || actual === null) {
      this.deps.logger.warn('Reauth rejected: channel account identity unavailable', {
        requestId,
        channel: event.channel,
      });
      this.deps.notify({
        requestId,
        kind: 'reauth-ota',
        payload: { ok: false, reason: 'identity-unavailable' },
      });
      return;
    }

    if (actual !== expectedChannelAccountId) {
      // 不记 channelAccountId 的值——那是账号身份，日志里只说明发生了不一致。
      this.deps.logger.warn('Reauth rejected: logged in as a different account', {
        requestId,
        channel: event.channel,
      });
      this.deps.notify({
        requestId,
        kind: 'reauth-ota',
        payload: { ok: false, reason: 'account-mismatch' },
      });
      return;
    }

    this.deps.logger.info('Reauth identity confirmed', { requestId, channel: event.channel });
    this.deps.notify({
      requestId,
      kind: 'reauth-ota',
      payload: { ok: true, credentialId: credential.id },
    });
  }
}
