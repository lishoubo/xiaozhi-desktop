import { toChannelId, toOtaAccountId, toOtaHotelId, type ChannelId, type OtaHotelId } from '../../domain/identity';
import { createOtaAccount, type OtaAccount, type OtaAccountCreateInput } from '../../domain/ota-account';
import type { OtaAccountRepository } from '../../domain/ports/repositories';
import type { ApplicationDatabase } from './application-database';

type OtaAccountRow = Readonly<{
  id: string;
  channel: string;
  otaHotelId: string;
  displayName: string | null;
  partitionName: string;
}>;

function accountFromRow(row: OtaAccountRow): OtaAccount {
  return {
    id: toOtaAccountId(row.id),
    channel: toChannelId(row.channel),
    otaHotelId: toOtaHotelId(row.otaHotelId),
    displayName: row.displayName,
    partitionName: row.partitionName,
  };
}

const SELECT_COLUMNS = `
  id,
  channel,
  ota_hotel_id AS otaHotelId,
  display_name AS displayName,
  partition_name AS partitionName
`;

export class SqliteOtaAccountRepository implements OtaAccountRepository {
  constructor(private readonly database: ApplicationDatabase) {}

  create(input: OtaAccountCreateInput): OtaAccount {
    const account = createOtaAccount(input);
    this.database
      .prepare(
        `
        INSERT INTO ota_account (id, channel, ota_hotel_id, display_name, partition_name)
        VALUES (@id, @channel, @otaHotelId, @displayName, @partitionName)
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
}
