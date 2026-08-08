/**
 * 订阅 TabEventBus 的 `tab:credential-checked` 事件，自己判断要不要探测酒店。
 * 这个事件是 ota-credential 对这次导航的判定/归并已经跑完之后才广播的，
 * 事件里带的 credential（如果非 null）已经真实写入数据库——不需要再自己查
 * 一次；不依赖 ota-credential 内部实现，只依赖这份事件契约。见
 * openspec/changes/split-ota-hotel-prob-feature/design.md 决策 2（及后续
 * 修复记录：为什么不能在 did-navigate 那一刻就拿到这份事件）。
 */
import { randomUUID } from 'node:crypto';
import { toChannelId, type ChannelId } from '../../domain/identity';
import type { OtaHotelRepository } from '../../domain/ports/repositories';
import type { AppLogger } from '../../shared/logging';
import type { TabCredentialCheckedEvent, TabEventBus } from '../services/tab-event-bus';
import type { HotelProbe } from '../channels/types';

export type OtaHotelProbFeatureDependencies = Readonly<{
  tabEventBus: TabEventBus;
  probes: ReadonlyMap<ChannelId, HotelProbe>;
  repository: OtaHotelRepository;
  logger: AppLogger;
}>;

export class OtaHotelProbService {
  constructor(private readonly deps: OtaHotelProbFeatureDependencies) {
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

    if (this.deps.repository.findByCredentialId(credential.id)) return;

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

    const now = Date.now();
    for (const hotel of outcome.hotels) {
      const existing = this.deps.repository.findByChannelAndHotelId(
        credential.channel,
        hotel.otaHotelId,
      );
      if (existing) {
        this.deps.repository.updateDiscovery(existing.id, {
          credentialId: credential.id,
          otaHotelName: hotel.otaHotelName,
          bindExtra: hotel.bindExtra,
          discoveredAt: now,
        });
      } else {
        this.deps.repository.create({
          id: randomUUID(),
          credentialId: credential.id,
          channel: credential.channel,
          otaHotelId: hotel.otaHotelId,
          otaHotelName: hotel.otaHotelName,
          bindExtra: hotel.bindExtra,
          discoveredAt: now,
        });
      }
    }
    this.deps.logger.info('Hotel probe saved hotels', {
      channel: event.channel,
      hotelCount: outcome.hotels.length,
    });
  }
}
