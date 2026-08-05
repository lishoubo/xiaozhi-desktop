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
import type { ChannelId, OtaHotelId } from '../identity';
import type { OtaAccount, OtaAccountCreateInput } from '../ota-account';

export interface CalendarRepository {
  load(): CalendarSnapshot;
  createEvent(input: CalendarEventCreateInput): CalendarEventRecord;
  updateEvent(input: CalendarEventUpdateInput): CalendarEventRecord;
  deleteEvent(id: string): void;
}

export interface OtaAccountRepository {
  create(input: OtaAccountCreateInput): OtaAccount;
  findByChannelAndHotelId(channel: ChannelId, otaHotelId: OtaHotelId): OtaAccount | null;
  /** 查重命中时把 partitionName 更新为最新登录，见 design.md 决策 7。 */
  updatePartitionName(id: OtaAccount['id'], partitionName: string): OtaAccount;
  /** 账号二级导航用：按渠道列出已绑定账号，discoveredAt 降序。 */
  listByChannel(channel: ChannelId): readonly OtaAccount[];
  /** 账号二级导航用：点击某一项打开时按 id 反查完整账号信息。 */
  findById(id: OtaAccount['id']): OtaAccount | null;
}
