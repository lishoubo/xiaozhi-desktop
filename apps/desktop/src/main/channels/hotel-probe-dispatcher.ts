/**
 * 酒店探测的**分发器**：订阅标签页事实 → 按渠道选 probe → 调用 → 记日志。
 * 探测逻辑本身不在这里，在各渠道的 `channels/<渠道>/hotel-prob.ts`；这里只有
 * 跨渠道的调度，所以是 Dispatcher 而不是 Service。
 *
 * 放在 `channels/` 而非 `services/`：探测与浏览器强相关（注入脚本、拦截响应、
 * 解析页面），是渠道能力的调度，不是业务编排。它依赖 `ota-tab/` 的事件总线——
 * 这是 `channels/` 唯一被放行的外部依赖，其余（services/database/gateway/ipc/
 * composition）由 eslint 禁止，需要什么就注入窄回调。
 *
 * 订阅的 `tab:credential-checked` 是 ota-credential 对这次导航的判定/归并已经
 * 跑完之后才广播的，事件里带的 credential（如果非 null）已经真实写入数据库——
 * 不需要再自己查一次；不依赖 ota-credential 内部实现，只依赖这份事件契约。见
 * openspec/changes/split-ota-hotel-prob-feature/design.md 决策 2（及后续
 * 修复记录：为什么不能在 did-navigate 那一刻就拿到这份事件）。
 *
 * 探测是**无副作用的查询**：只产出候选，不写库。酒店信息仅在用户从候选中选定
 * 后才保存（写入口是 `OtaHotelRepository.save()`）。这里也不做「探过就跳过」的
 * 早退——用户否决候选后必须能对同一凭证再次探测。见
 * openspec/changes/ota-hotel-stores-hotel-info-only/design.md 决策 3、4。
 *
 * 候选结果暂无消费者，只记日志；向上通知由后续「绑定流程」变更接通。
 */
import { toChannelId, type ChannelId } from '../ids';
import type { AppLogger } from '../../shared/logging';
import type { TabCredentialCheckedEvent, TabEventBus } from '../ota-tab';
import type { UiWaitingResultEnvelope } from '../../shared/types/ui-waiting-result-types';
import type { HotelProbe } from './types';

export type HotelProbeDispatcherDependencies = Readonly<{
  tabEventBus: TabEventBus;
  probes: ReadonlyMap<ChannelId, HotelProbe>;
  logger: AppLogger;
  /**
   * 把 UI 在等的结果送出去。窄回调而非直接 send —— `channels/` 不认识 electron
   * 与 ipc，composition root 负责把它接到 `webContents.send`。
   */
  notify: (envelope: UiWaitingResultEnvelope) => void;
}>;

export class HotelProbeDispatcher {
  constructor(private readonly deps: HotelProbeDispatcherDependencies) {
    this.deps.tabEventBus.on('tab:credential-checked', (event: TabCredentialCheckedEvent) => {
      void this.onCredentialChecked(event);
    });
  }

  private async onCredentialChecked(event: TabCredentialCheckedEvent): Promise<void> {
    if (event.outcome.kind !== 'checked') return;
    const { credential } = event.outcome;
    if (!credential) return;

    const probe = this.deps.probes.get(toChannelId(event.channel));
    if (!probe || !probe.isProbeableUrl(event.url)) return;

    let outcome;
    try {
      outcome = await probe.probe(credential, event.webContents);
    } catch (error) {
      this.deps.logger.warn('Hotel probe failed', {
        channel: event.channel,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      return;
    }
    if (outcome.kind === 'none') return;

    this.deps.logger.info('Hotel probe found candidates', {
      channel: event.channel,
      hotelCount: outcome.hotels.length,
    });

    // 没有绑定意图就没有等待方：探测照跑，结果无人接收。
    if (event.intent?.kind !== 'bind-hotel') return;

    // 标签页已经关了说明用户已放弃，候选没有意义。这个判断必须在 probe() 之后
    // ——探测期间用户随时可能关闭。
    if (event.webContents.isDestroyed()) {
      this.deps.logger.info('Hotel probe candidates discarded: tab closed', {
        channel: event.channel,
      });
      return;
    }

    this.deps.notify({
      requestId: event.intent.requestId,
      kind: 'bind-hotel',
      payload: {
        credentialId: credential.id,
        hotels: outcome.hotels.map((hotel) => ({
          otaHotelId: hotel.otaHotelId,
          otaHotelName: hotel.otaHotelName,
          bindExtra: hotel.bindExtra,
        })),
      },
    });
  }
}
