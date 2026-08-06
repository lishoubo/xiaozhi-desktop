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
import type { OtaAccount, OtaAccountCreateInput, OtaAccountDiscoveryUpdate } from '../ota-account';
import type { OtaCredential, OtaCredentialCreateInput } from '../ota-credential';

export interface CalendarRepository {
  load(): CalendarSnapshot;
  createEvent(input: CalendarEventCreateInput): CalendarEventRecord;
  updateEvent(input: CalendarEventUpdateInput): CalendarEventRecord;
  deleteEvent(id: string): void;
}

export interface OtaAccountRepository {
  create(input: OtaAccountCreateInput): OtaAccount;
  findByChannelAndHotelId(channel: ChannelId, otaHotelId: OtaHotelId): OtaAccount | null;
  updateDiscovery(id: OtaAccount['id'], update: OtaAccountDiscoveryUpdate): OtaAccount;
  /** 账号二级导航用：按渠道列出已绑定账号，discoveredAt 降序。 */
  listByChannel(channel: ChannelId): readonly OtaAccount[];
  /** 账号二级导航用：点击某一项打开时按 id 反查完整账号信息。 */
  findById(id: OtaAccount['id']): OtaAccount | null;
}

export interface OtaCredentialRepository {
  create(input: OtaCredentialCreateInput): OtaCredential;
  findById(id: OtaCredentialId): OtaCredential | null;
  findByPartitionName(partitionName: string): OtaCredential | null;
}
