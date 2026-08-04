import { toChannelId, toOtaAccountId, toOtaHotelId, type ChannelId, type OtaHotelId } from '../../domain/identity';
import { createOtaAccount, type OtaAccount, type OtaAccountCreateInput } from '../../domain/ota-account';
import type { OtaAccountRepository } from '../../domain/ports/repositories';
import type { ApplicationDatabase } from './application-database';

type OtaAccountRow = Readonly<{
  id: string;
  channel: string;
  otaHotelId: string;
  otaHotelName: string | null;
  partitionName: string;
  channelContext: string | null;
  discoveredAt: number;
}>;

function accountFromRow(row: OtaAccountRow): OtaAccount {
  return {
    id: toOtaAccountId(row.id),
    channel: toChannelId(row.channel),
    otaHotelId: toOtaHotelId(row.otaHotelId),
    otaHotelName: row.otaHotelName,
    partitionName: row.partitionName,
    channelContext: row.channelContext,
    discoveredAt: row.discoveredAt,
  };
}

const SELECT_COLUMNS = `
  id,
  channel,
  ota_hotel_id AS otaHotelId,
  ota_hotel_name AS otaHotelName,
  partition_name AS partitionName,
  channel_context AS channelContext,
  discovered_at AS discoveredAt
`;

export class SqliteOtaAccountRepository implements OtaAccountRepository {
  constructor(private readonly database: ApplicationDatabase) {}

  create(input: OtaAccountCreateInput): OtaAccount {
    const account = createOtaAccount(input);
    this.database
      .prepare(
        `
        INSERT INTO ota_account
          (id, channel, ota_hotel_id, ota_hotel_name, partition_name, channel_context, discovered_at)
        VALUES
          (@id, @channel, @otaHotelId, @otaHotelName, @partitionName, @channelContext, @discoveredAt)
      `,
      )
      .run(account);
    return account;
  }

  findByChannelAndHotelId(channel: ChannelId, otaHotelId: OtaHotelId): OtaAccount | null {
    const row = this.database
      .prepare<[string, string], OtaAccountRow>(
        `SELECT ${SELECT_COLUMNS} FROM ota_account WHERE channel = ? AND ota_hotel_id = ?`,
      )
      .get(channel, otaHotelId);
    return row ? accountFromRow(row) : null;
  }

  updatePartitionName(id: OtaAccount['id'], partitionName: string): OtaAccount {
    const result = this.database
      .prepare(
        `UPDATE ota_account
         SET partition_name = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(partitionName, id);
    if (result.changes === 0) throw new Error('未找到 OtaAccount');
    const row = this.database
      .prepare<[string], OtaAccountRow>(`SELECT ${SELECT_COLUMNS} FROM ota_account WHERE id = ?`)
      .get(id);
    if (!row) throw new Error('未找到 OtaAccount');
    return accountFromRow(row);
  }

  listByChannel(channel: ChannelId): readonly OtaAccount[] {
    const rows = this.database
      .prepare<[string], OtaAccountRow>(
        `SELECT ${SELECT_COLUMNS} FROM ota_account WHERE channel = ? ORDER BY discovered_at DESC`,
      )
      .all(channel);
    return rows.map(accountFromRow);
  }

  findById(id: OtaAccount['id']): OtaAccount | null {
    const row = this.database
      .prepare<[string], OtaAccountRow>(`SELECT ${SELECT_COLUMNS} FROM ota_account WHERE id = ?`)
      .get(id);
    return row ? accountFromRow(row) : null;
  }
}
