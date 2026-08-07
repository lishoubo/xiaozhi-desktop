/**
 * domain 需要外界提供的持久化能力（接口，无实现）。
 *
 * 实现在 `main/` 侧（当前是 SQLite），composition root 负责装配。
 * 抽这层不是为了「将来换数据库」，而是为了**换存储位置** —— rms 接管后，
 * 部分数据的权威会挪到云端，本地只留缓存，那时换的是实现而非接口。
 */
import type {
  CalendarEventCreateInput,
  CalendarEventRecord,
  CalendarEventUpdateInput,
  CalendarSnapshot,
} from '../calendar';
import type { ChannelId, OtaCredentialId, OtaHotelId } from '../identity';
import type {
  OtaCredential,
  OtaCredentialCreateInput,
  OtaCredentialIdentityUpdate,
  OtaCredentialPartitionUpdate,
} from '../ota-credential';
import type {
  OtaHotelProb,
  OtaHotelProbCreateInput,
  OtaHotelProbDiscoveryUpdate,
} from '../ota-hotel-prob';

export interface CalendarRepository {
  load(): CalendarSnapshot;
  createEvent(input: CalendarEventCreateInput): CalendarEventRecord;
  updateEvent(input: CalendarEventUpdateInput): CalendarEventRecord;
  deleteEvent(id: string): void;
}

export interface OtaHotelProbRepository {
  create(input: OtaHotelProbCreateInput): OtaHotelProb;
  findByChannelAndHotelId(channel: ChannelId, otaHotelId: OtaHotelId): OtaHotelProb | null;
  findByCredentialId(credentialId: OtaCredentialId): OtaHotelProb | null;
  updateDiscovery(id: OtaHotelProb['id'], update: OtaHotelProbDiscoveryUpdate): OtaHotelProb;
}

export interface OtaCredentialRepository {
  create(input: OtaCredentialCreateInput): OtaCredential;
  listByChannel(channel: ChannelId): readonly OtaCredential[];
  findById(id: OtaCredentialId): OtaCredential | null;
  findByPartitionName(partitionName: string): OtaCredential | null;
  findByChannelAndAccountId(channel: ChannelId, channelAccountId: string): OtaCredential | null;
  updateIdentity(id: OtaCredentialId, update: OtaCredentialIdentityUpdate): OtaCredential;
  updatePartitionAndIdentity(
    id: OtaCredentialId,
    update: OtaCredentialPartitionUpdate,
  ): OtaCredential;
}
