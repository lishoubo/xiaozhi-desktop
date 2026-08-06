import type { WebContents } from 'electron';
import type { ChannelId } from '../../domain/identity';
import { toOtaAccountId, toOtaCredentialId } from '../../domain/identity';
import type { OtaCredential } from '../../domain/ota-credential';
import type {
  OtaAccountRepository,
  OtaCredentialRepository,
} from '../../domain/ports/repositories';
import type { AppLogger } from '../../shared/logging';
import type { DiscoveredOtaHotel, DiscoveryProbe } from './discovery-probe-port';
import type { DiscoverCtrip } from '../ota/ctrip/discover-ctrip';
import type { DiscoverDouyin } from '../ota/douyin/discover-douyin';
import type { DiscoverMeituan } from '../ota/meituan/discover-meituan';

const CTRIP_CHANNEL = 'ctrip';
const DOUYIN_CHANNEL = 'douyin';
const MEITUAN_CHANNEL = 'meituan';

export type DiscoverAndCreateDependencies = Readonly<{
  probes: ReadonlyMap<ChannelId, DiscoveryProbe>;
  discoverCtrip: DiscoverCtrip;
  discoverDouyin: DiscoverDouyin;
  discoverMeituan: DiscoverMeituan;
  accountRepository: OtaAccountRepository;
  credentialRepository: OtaCredentialRepository;
  generateAccountId: () => string;
  generateCredentialId: () => string;
  removePendingPartition: (partitionName: string) => Promise<void>;
  onCredentialPartitionReplaced?: (
    previousPartitionName: string,
    nextPartitionName: string,
  ) => void | Promise<void>;
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

    const isCtrip = channel === CTRIP_CHANNEL;
    const isDouyin = channel === DOUYIN_CHANNEL;
    const isMeituan = channel === MEITUAN_CHANNEL;
    const probe = isCtrip || isDouyin || isMeituan ? null : this.deps.probes.get(channel);
    if (!isCtrip && !isDouyin && !isMeituan && !probe) {
      this.deps.logger.info('Discovery skipped: no probe registered for channel', { channel });
      return false;
    }

    this.deps.logger.info('Discovery triggered', { channel });
    this.inflight.add(partitionName);
    try {
      if (isCtrip) {
        const result = await this.deps.discoverCtrip(partitionName, landingUrl, webContents);
        this.deps.logger.info('Ctrip discovery outcome', { kind: result.kind });
        if (result.kind === 'none') return false;
        if (result.kind === 'multiple') {
          this.deps.logger.info('Ctrip discovery found multiple hotels, awaiting user selection', {
            count: result.hotels.length,
          });
          return false;
        }
        await this.persistIdentifiedResult(
          partitionName,
          channel,
          result.credential,
          result.hotels,
        );
        this.bound.add(partitionName);
        this.deps.logger.info('Ctrip discovery saved hotels', {
          hotelCount: result.hotels.length,
        });
        return true;
      }
      if (isDouyin) {
        const result = await this.deps.discoverDouyin(partitionName, landingUrl, webContents);
        this.deps.logger.info('Douyin discovery outcome', { kind: result.kind });
        if (result.kind === 'none') return false;
        await this.persistIdentifiedResult(
          partitionName,
          channel,
          result.credential,
          result.hotels,
        );
        this.bound.add(partitionName);
        this.deps.logger.info('Douyin discovery saved hotels', {
          hotelCount: result.hotels.length,
        });
        return true;
      }
      if (isMeituan) {
        const result = await this.deps.discoverMeituan(partitionName, landingUrl, webContents);
        this.deps.logger.info('Meituan discovery outcome', { kind: result.kind });
        if (result.kind === 'none') return false;
        await this.persistIdentifiedResult(
          partitionName,
          channel,
          result.credential,
          result.hotels,
        );
        this.bound.add(partitionName);
        this.deps.logger.info('Meituan discovery saved hotels', {
          hotelCount: result.hotels.length,
        });
        return true;
      }
      if (!probe) return false;
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
    const credential = this.findOrCreateCredential(partitionName, channel, now);

    this.upsertAccount(channel, credential, hotel, now);
    await this.deps.removePendingPartition(partitionName);
    this.deps.onAccountBound?.(channel);
  }

  private findOrCreateCredential(
    partitionName: string,
    channel: ChannelId,
    now: number,
  ): OtaCredential {
    const credential =
      this.deps.credentialRepository.findByPartitionName(partitionName) ??
      this.deps.credentialRepository.create({
        id: toOtaCredentialId(this.deps.generateCredentialId()),
        channel,
        channelAccountId: null,
        partitionName,
        credentialExtra: null,
        discoveredAt: now,
        lastRefreshedAt: null,
      });
    if (credential.channel !== channel) {
      throw new Error('partition 对应 credential 的渠道与本次探测渠道不一致');
    }
    return credential;
  }

  private async persistIdentifiedResult(
    partitionName: string,
    channel: ChannelId,
    identity: Readonly<{
      channelAccountId: string;
      credentialExtra: OtaCredential['credentialExtra'];
    }>,
    hotels: readonly DiscoveredOtaHotel[],
  ): Promise<void> {
    const now = Date.now();
    const existing = this.deps.credentialRepository.findByPartitionName(partitionName);
    const identified = this.deps.credentialRepository.findByChannelAndAccountId(
      channel,
      identity.channelAccountId,
    );
    let credential: OtaCredential;
    let replacedPartitionName: string | null = null;
    if (identified && identified.id !== existing?.id) {
      if (identified.channel !== channel) {
        throw new Error('渠道账号身份对应 credential 的渠道不一致');
      }
      if (existing) {
        throw new Error('新 partition 已关联另一条 credential，无法替换渠道账号登录态');
      }
      replacedPartitionName = identified.partitionName;
      credential = this.deps.credentialRepository.updatePartitionAndIdentity(identified.id, {
        partitionName,
        channelAccountId: identity.channelAccountId,
        credentialExtra: identity.credentialExtra,
        lastRefreshedAt: now,
      });
    } else if (existing) {
      if (existing.channel !== channel) {
        throw new Error('partition 对应 credential 的渠道与本次身份探测渠道不一致');
      }
      credential = this.deps.credentialRepository.updateIdentity(existing.id, {
        channelAccountId: identity.channelAccountId,
        credentialExtra: identity.credentialExtra,
        lastRefreshedAt: now,
      });
    } else {
      credential = this.deps.credentialRepository.create({
        id: toOtaCredentialId(this.deps.generateCredentialId()),
        channel,
        channelAccountId: identity.channelAccountId,
        partitionName,
        credentialExtra: identity.credentialExtra,
        discoveredAt: now,
        lastRefreshedAt: now,
      });
    }

    for (const hotel of hotels) this.upsertAccount(channel, credential, hotel, now);
    await this.deps.removePendingPartition(partitionName);
    if (replacedPartitionName && replacedPartitionName !== partitionName) {
      try {
        await this.deps.onCredentialPartitionReplaced?.(replacedPartitionName, partitionName);
      } catch (error) {
        this.deps.logger.warn('Replaced credential partition could not be retired', {
          channel,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
      }
    }
    this.deps.onAccountBound?.(channel);
  }

  private upsertAccount(
    channel: ChannelId,
    credential: OtaCredential,
    hotel: DiscoveredOtaHotel,
    now: number,
  ): void {
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
  }
}
