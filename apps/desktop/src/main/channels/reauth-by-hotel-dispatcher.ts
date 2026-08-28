/**
 * 按门店重认的**核对器**：订阅标签页事实 → 探测该账号能管哪些门店 → 比对这条绑定
 * 的门店在不在里面 → 把结论送回 UI。
 *
 * 与 `HotelProbeDispatcher`、`OtaReauthDispatcher` 是并列的兄弟订阅者，各认各的
 * intent kind，互不感知。
 *
 * ## 为什么不并进那两个
 *
 * ```
 * HotelProbeDispatcher   探测 → 候选发给用户挑 → 改写门店关系   （绑定）
 * OtaReauthDispatcher    不探测 → 比对账号标识                  （常规重登）
 * 这里                   探测 → 自己比对门店 → 门店关系不变      （老数据重登）
 * ```
 *
 * 前半段像绑定（要探测）、后半段像重登（只换凭证）。并进任一个都会让「探不探」
 * 或「结果给谁」的判断散进同一个 dispatcher，所以单独成型。**复用的是底层
 * `HotelProbe`，不是 dispatcher。**
 *
 * ## 为什么探测结果不给用户挑
 *
 * 门店是已知的（`intent.expectedOtaHotelId` 就是它）。探测在这里不是「发现候选」，
 * 而是反过来回答「这个账号管不管得了这家门店」——RMS 后台绑的老记录没有渠道账号
 * 标识，认不出该登录哪个账号，只能用门店当锚点倒推。
 *
 * ## 写远端不在这里
 *
 * `channels/` 不认识 gateway 与 session（eslint 禁止）。核对通过时把命中门店的
 * `bindExtra` 放进结果 payload，由 UI 在用户确认后转交 `confirmReauth`（service
 * 层）写远端 —— 与 `OtaReauthDispatcher` 把 cookie 读取推迟到 confirm 同理。
 */
import { toChannelId, type ChannelId } from '../ids';
import { safeLogErrorDetails, type AppLogger } from '../../shared/logging';
import type { TabCredentialCheckedEvent, TabEventBus } from '../ota-tab';
import type { UiWaitingResultEnvelope } from '../../shared/types/ui-waiting-result-types';
import type { HotelProbe } from './types';

export type ReauthByHotelDispatcherDependencies = Readonly<{
  tabEventBus: TabEventBus;
  probes: ReadonlyMap<ChannelId, HotelProbe>;
  logger: AppLogger;
  /** 同两个兄弟 dispatcher：窄回调，composition root 接到 `webContents.send`。 */
  notify: (envelope: UiWaitingResultEnvelope) => void;
}>;

export class ReauthByHotelDispatcher {
  constructor(private readonly deps: ReauthByHotelDispatcherDependencies) {
    this.deps.tabEventBus.on('tab:credential-checked', (event: TabCredentialCheckedEvent) => {
      void this.onCredentialChecked(event);
    });
  }

  private async onCredentialChecked(event: TabCredentialCheckedEvent): Promise<void> {
    if (event.intent?.kind !== 'reauth-by-hotel') return;
    if (event.outcome.kind !== 'checked') return;

    const { requestId, expectedOtaHotelId } = event.intent;
    const { credential } = event.outcome;

    // 拿不到凭证就没有可用的登录态，后续 confirmReauth 也无从取 cookie。
    if (credential === null) {
      this.deps.logger.warn('Reauth-by-hotel rejected: credential unavailable', {
        requestId,
        channel: event.channel,
      });
      this.notifyFailure(requestId, 'identity-unavailable');
      return;
    }

    const probe = this.deps.probes.get(toChannelId(event.channel));
    if (!probe || !probe.isProbeableUrl(event.url)) return;

    let outcome;
    try {
      outcome = await probe.probe(credential, event.webContents);
    } catch (error) {
      this.deps.logger.warn('Reauth-by-hotel probe failed', {
        requestId,
        channel: event.channel,
        error: safeLogErrorDetails(error),
      });
      this.notifyFailure(requestId, 'identity-unavailable');
      return;
    }

    // 标签页已经关了说明用户已放弃。这个判断必须在 probe() 之后——探测期间用户
    // 随时可能关闭。
    if (event.webContents.isDestroyed()) {
      this.deps.logger.info('Reauth-by-hotel result discarded: tab closed', { requestId });
      return;
    }

    // 「探不出门店」与「探出来了但不是这家」是两回事：前者可能是页面异常或超时，
    // 重试有意义；后者是选错了账号，重试多少次都一样。分开报，别让用户白试。
    if (outcome.kind === 'none') {
      this.deps.logger.warn('Reauth-by-hotel rejected: no hotel discovered', {
        requestId,
        channel: event.channel,
      });
      this.notifyFailure(requestId, 'identity-unavailable');
      return;
    }

    const matched = outcome.hotels.find((hotel) => hotel.otaHotelId === expectedOtaHotelId);
    if (!matched) {
      this.deps.logger.warn('Reauth-by-hotel rejected: hotel not managed by this account', {
        requestId,
        channel: event.channel,
        discoveredCount: outcome.hotels.length,
      });
      this.deps.notify({
        requestId,
        kind: 'reauth-ota',
        payload: {
          ok: false,
          reason: 'hotel-mismatch',
          // 带上实际管的门店，UI 才能说清「这个账号管的是 X，不是这家」。
          actualHotels: outcome.hotels.map((hotel) => ({
            otaHotelId: hotel.otaHotelId,
            otaHotelName: hotel.otaHotelName,
            bindExtra: hotel.bindExtra,
          })),
        },
      });
      return;
    }

    this.deps.logger.info('Reauth-by-hotel confirmed', { requestId, channel: event.channel });
    // 只报「核对通过 + 是哪个凭证」。命中门店的 `bindExtra`（抖音 merchantGroupId /
    // 美团 otaPartnerId）**有意不带回**：那是门店级参数，同一账号下每家门店可能不同，
    // 而这条路没让用户确认门店，探测到的值取自当时页面上下文，未必是这条绑定该用的。
    // 账号级的身份补写由 `confirmReauth` 自己从凭证取，不经过这里。
    this.deps.notify({
      requestId,
      kind: 'reauth-ota',
      payload: { ok: true, credentialId: credential.id },
    });
  }

  private notifyFailure(
    requestId: string,
    reason: 'identity-unavailable' | 'hotel-mismatch',
  ): void {
    this.deps.notify({ requestId, kind: 'reauth-ota', payload: { ok: false, reason } });
  }
}
