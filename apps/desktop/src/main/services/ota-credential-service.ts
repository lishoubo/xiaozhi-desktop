/**
 * 本文件只处理登录判定和身份归并（渠道账号识别、OtaCredential 归并）。不代替
 * 上层判断任何业务动作是否该发生——上层 Feature（如
 * `main/features/ota-hotel-prob/`）要感知处理结果，去订阅
 * `main/services/tab-event-bus.ts` 广播的 `tab:credential-checked` 事件，不要
 * 自己再查一次数据库。`trigger()` 的返回值就是这次处理最终确认的
 * `OtaCredential`（没有则为 null），由 `BrowserManager` 负责在这个返回值确定
 * 之后才广播，保证下游订阅者收到事件时 credential 已经真实写入数据库。
 *
 * 不写酒店信息——酒店探测已独立成 `main/features/ota-hotel-prob/`，见
 * openspec/changes/split-ota-hotel-prob-feature/design.md 决策 7。
 */
import type { WebContents } from 'electron';
import type { ChannelId } from '../ids';
import { toOtaCredentialId } from '../ids';
import type { OtaCredential } from '../../shared/types/ota-credential';
import type { OtaCredentialRepository } from '../database/ota-credential-repository';
import type { AppLogger } from '../../shared/logging';
import type { DiscoverCtrip } from '../channels/ctrip/discovery';
import type { DiscoverDouyin } from '../channels/douyin/discovery';
import type { DiscoverMeituan } from '../channels/meituan/discovery';

const CTRIP_CHANNEL = 'ctrip';
const DOUYIN_CHANNEL = 'douyin';
const MEITUAN_CHANNEL = 'meituan';

export type DiscoverAndCreateDependencies = Readonly<{
  discoverCtrip: DiscoverCtrip;
  discoverDouyin: DiscoverDouyin;
  discoverMeituan: DiscoverMeituan;
  credentialRepository: OtaCredentialRepository;
  generateCredentialId: () => string;
  removePendingPartition: (partitionName: string) => Promise<void>;
  onCredentialPartitionReplaced?: (
    previousPartitionName: string,
    nextPartitionName: string,
  ) => void | Promise<void>;
  logger: AppLogger;
  onAccountBound?: (channel: ChannelId) => void;
}>;

export class OtaCredentialService {
  private readonly inflight = new Set<string>();
  private readonly bound = new Set<string>();

  constructor(private readonly deps: DiscoverAndCreateDependencies) {}

  /** 列出某渠道下已探测出的登录凭据（供账号切换 UI 展示）。 */
  listByChannel(channel: ChannelId): readonly OtaCredential[] {
    return this.deps.credentialRepository.listByChannel(channel);
  }

  async trigger(
    partitionName: string,
    channel: ChannelId,
    landingUrl: string,
    webContents: WebContents,
  ): Promise<OtaCredential | null> {
    if (this.bound.has(partitionName) || this.inflight.has(partitionName)) return null;

    const isCtrip = channel === CTRIP_CHANNEL;
    const isDouyin = channel === DOUYIN_CHANNEL;
    const isMeituan = channel === MEITUAN_CHANNEL;
    if (!isCtrip && !isDouyin && !isMeituan) {
      this.deps.logger.info('Discovery skipped: no probe registered for channel', { channel });
      return null;
    }

    this.deps.logger.info('Discovery triggered', { channel });
    this.inflight.add(partitionName);
    try {
      if (isCtrip) {
        const result = await this.deps.discoverCtrip(partitionName, landingUrl, webContents);
        this.deps.logger.info('Ctrip discovery outcome', { kind: result.kind });
        if (result.kind === 'none') return null;
        if (result.kind === 'multiple') {
          this.deps.logger.info('Ctrip discovery found multiple hotels, awaiting user selection', {
            count: result.hotels.length,
          });
          return null;
        }
        const credential = await this.persistIdentifiedResult(
          partitionName,
          channel,
          result.credential,
        );
        this.bound.add(partitionName);
        this.deps.logger.info('Ctrip discovery saved credential', { channel });
        return credential;
      }
      if (isDouyin) {
        const result = await this.deps.discoverDouyin(partitionName, landingUrl, webContents);
        this.deps.logger.info('Douyin discovery outcome', { kind: result.kind });
        if (result.kind === 'none') return null;
        const credential = await this.persistIdentifiedResult(
          partitionName,
          channel,
          result.credential,
        );
        this.bound.add(partitionName);
        this.deps.logger.info('Douyin discovery saved credential', { channel });
        return credential;
      }
      if (isMeituan) {
        const result = await this.deps.discoverMeituan(partitionName, landingUrl, webContents);
        this.deps.logger.info('Meituan discovery outcome', { kind: result.kind });
        if (result.kind === 'none') return null;
        const credential = await this.persistIdentifiedResult(
          partitionName,
          channel,
          result.credential,
        );
        this.bound.add(partitionName);
        this.deps.logger.info('Meituan discovery saved credential', { channel });
        return credential;
      }
      return null;
    } catch (error) {
      this.deps.logger.warn('Discovery failed', {
        channel,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      return null;
    } finally {
      this.inflight.delete(partitionName);
    }
  }

  private async persistIdentifiedResult(
    partitionName: string,
    channel: ChannelId,
    identity: Readonly<{
      channelAccountId: string;
      credentialExtra: OtaCredential['credentialExtra'];
    }>,
  ): Promise<OtaCredential> {
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
    return credential;
  }
}
