import {
  toChannelId,
  toOtaAccountId,
  toOtaCredentialId,
  toOtaHotelId,
  type ChannelId,
  type OtaHotelId,
} from '../../domain/identity';
import {
  createOtaAccount,
  type OtaAccount,
  type OtaAccountCreateInput,
  type OtaAccountDiscoveryUpdate,
} from '../../domain/ota-account';
import type { OtaAccountRepository } from '../../domain/ports/repositories';
import type { ApplicationDatabase } from './application-database';
import { parseJsonObject, serializeJsonObject } from './json-storage';

type OtaAccountRow = Readonly<{
  id: string;
  credentialId: string;
  channel: string;
  otaHotelId: string;
  otaHotelName: string | null;
  bindExtra: string | null;
  discoveredAt: number;
}>;

function accountFromRow(row: OtaAccountRow): OtaAccount {
  return createOtaAccount({
    id: toOtaAccountId(row.id),
    credentialId: toOtaCredentialId(row.credentialId),
    channel: toChannelId(row.channel),
    otaHotelId: toOtaHotelId(row.otaHotelId),
    otaHotelName: row.otaHotelName,
    bindExtra: parseJsonObject(row.bindExtra, 'bindExtra'),
    discoveredAt: row.discoveredAt,
  });
}

const SELECT_COLUMNS = `
  id,
  credential_id AS credentialId,
  channel,
  ota_hotel_id AS otaHotelId,
  ota_hotel_name AS otaHotelName,
  bind_extra AS bindExtra,
  discovered_at AS discoveredAt
`;

export class SqliteOtaAccountRepository implements OtaAccountRepository {
  constructor(private readonly database: ApplicationDatabase) {}

  create(input: OtaAccountCreateInput): OtaAccount {
    const account = createOtaAccount(input);
    this.database
      .prepare(
        `INSERT INTO ota_account
          (id, credential_id, channel, ota_hotel_id, ota_hotel_name, bind_extra, discovered_at)
         VALUES
          (@id, @credentialId, @channel, @otaHotelId, @otaHotelName, @bindExtra, @discoveredAt)`,
      )
      .run({ ...account, bindExtra: serializeJsonObject(account.bindExtra) });
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

  updateDiscovery(id: OtaAccount['id'], update: OtaAccountDiscoveryUpdate): OtaAccount {
    const result = this.database
      .prepare(
        `UPDATE ota_account
         SET credential_id = @credentialId,
             ota_hotel_name = @otaHotelName,
             bind_extra = @bindExtra,
             discovered_at = @discoveredAt,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = @id`,
      )
      .run({ ...update, id, bindExtra: serializeJsonObject(update.bindExtra) });
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
