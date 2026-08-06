import type { WebContents } from 'electron';
import type { ChannelId } from '../../domain/identity';
import { toOtaAccountId, toOtaCredentialId } from '../../domain/identity';
import type {
  OtaAccountRepository,
  OtaCredentialRepository,
} from '../../domain/ports/repositories';
import type { AppLogger } from '../../shared/logging';
import type { DiscoveredOtaHotel, DiscoveryProbe } from './discovery-probe-port';

export type DiscoverAndCreateDependencies = Readonly<{
  probes: ReadonlyMap<ChannelId, DiscoveryProbe>;
  accountRepository: OtaAccountRepository;
  credentialRepository: OtaCredentialRepository;
  generateAccountId: () => string;
  generateCredentialId: () => string;
  removePendingPartition: (partitionName: string) => Promise<void>;
  logger: AppLogger;
  onAccountBound?: (channel: ChannelId) => void;
}>;

export class DiscoverAndCreate {
  private readonly inflight = new Set<string>();
  private readonly bound = new Set<string>();

  constructor(private readonly deps: DiscoverAndCreateDependencies) {}

  async trigger(
    partitionName: string,
    channel: ChannelId,
    landingUrl: string,
    webContents: WebContents,
  ): Promise<boolean> {
    if (this.bound.has(partitionName) || this.inflight.has(partitionName)) return false;

    const probe = this.deps.probes.get(channel);
    if (!probe) {
      this.deps.logger.info('Discovery skipped: no probe registered for channel', { channel });
      return false;
    }

    this.deps.logger.info('Discovery triggered', { channel });
    this.inflight.add(partitionName);
    try {
      const outcome = await probe.discover(partitionName, landingUrl, webContents);
      this.deps.logger.info('Discovery outcome', { channel, kind: outcome.kind });
      switch (outcome.kind) {
        case 'unsupported':
        case 'none':
          return false;
        case 'single':
          await this.createOrUpdate(partitionName, channel, outcome.hotel);
          this.bound.add(partitionName);
          this.deps.logger.info('Discovery bound OtaAccount', {
            channel,
            otaHotelId: outcome.hotel.otaHotelId,
          });
          return true;
        case 'multiple':
          this.deps.logger.info('Discovery found multiple hotels, awaiting user selection', {
            channel,
            count: outcome.hotels.length,
          });
          return false;
      }
    } catch (error) {
      this.deps.logger.warn('Discovery failed', {
        channel,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      return false;
    } finally {
      this.inflight.delete(partitionName);
    }
  }

  private async createOrUpdate(
    partitionName: string,
    channel: ChannelId,
    hotel: DiscoveredOtaHotel,
  ): Promise<void> {
    const now = Date.now();
    const credential =
      this.deps.credentialRepository.findByPartitionName(partitionName) ??
      this.deps.credentialRepository.create({
        id: toOtaCredentialId(this.deps.generateCredentialId()),
        channel,
        partitionName,
        credentialExtra: null,
        discoveredAt: now,
        lastRefreshedAt: null,
      });
    if (credential.channel !== channel) {
      throw new Error('partition 对应 credential 的渠道与本次探测渠道不一致');
    }

    const existing = this.deps.accountRepository.findByChannelAndHotelId(channel, hotel.otaHotelId);
    if (existing) {
      this.deps.accountRepository.updateDiscovery(existing.id, {
        credentialId: credential.id,
        otaHotelName: hotel.otaHotelName,
        bindExtra: hotel.bindExtra,
        discoveredAt: now,
      });
    } else {
      this.deps.accountRepository.create({
        id: toOtaAccountId(this.deps.generateAccountId()),
        credentialId: credential.id,
        channel,
        otaHotelId: hotel.otaHotelId,
        otaHotelName: hotel.otaHotelName,
        bindExtra: hotel.bindExtra,
        discoveredAt: now,
      });
    }
    await this.deps.removePendingPartition(partitionName);
    this.deps.onAccountBound?.(channel);
  }
}
