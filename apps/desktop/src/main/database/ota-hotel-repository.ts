import {
  toChannelId,
  toOtaCredentialId,
  toOtaHotelId,
  type ChannelId,
  type OtaCredentialId,
  type OtaHotelId,
} from '../ids';
import {
  type OtaHotel,
  type OtaHotelCreateInput,
  type OtaHotelDiscoveryUpdate,
} from '../../shared/types/ota-hotel';
import type { OtaHotelRepository } from '../repositories';
import type { ApplicationDatabase } from './application-database';
import { parseJsonObject, serializeJsonObject } from './json-storage';

type OtaHotelRow = Readonly<{
  id: string;
  credentialId: string;
  channel: string;
  otaHotelId: string;
  otaHotelName: string | null;
  bindExtra: string | null;
  discoveredAt: number;
}>;

function hotelFromRow(row: OtaHotelRow): OtaHotel {
  return {
    id: row.id,
    credentialId: toOtaCredentialId(row.credentialId),
    channel: toChannelId(row.channel),
    otaHotelId: toOtaHotelId(row.otaHotelId),
    otaHotelName: row.otaHotelName,
    bindExtra: parseJsonObject(row.bindExtra, 'bindExtra'),
    discoveredAt: row.discoveredAt,
  };
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

export class SqliteOtaHotelRepository implements OtaHotelRepository {
  constructor(private readonly database: ApplicationDatabase) {}

  create(input: OtaHotelCreateInput): OtaHotel {
    const hotel: OtaHotel = { ...input };
    this.database
      .prepare(
        `INSERT INTO ota_hotel
          (id, credential_id, channel, ota_hotel_id, ota_hotel_name, bind_extra, discovered_at)
         VALUES
          (@id, @credentialId, @channel, @otaHotelId, @otaHotelName, @bindExtra, @discoveredAt)`,
      )
      .run({ ...hotel, bindExtra: serializeJsonObject(hotel.bindExtra) });
    return hotel;
  }

  findByChannelAndHotelId(channel: ChannelId, otaHotelId: OtaHotelId): OtaHotel | null {
    const row = this.database
      .prepare<[string, string], OtaHotelRow>(
        `SELECT ${SELECT_COLUMNS} FROM ota_hotel WHERE channel = ? AND ota_hotel_id = ?`,
      )
      .get(channel, otaHotelId);
    return row ? hotelFromRow(row) : null;
  }

  findByCredentialId(credentialId: OtaCredentialId): OtaHotel | null {
    const row = this.database
      .prepare<[string], OtaHotelRow>(
        `SELECT ${SELECT_COLUMNS} FROM ota_hotel WHERE credential_id = ?`,
      )
      .get(credentialId);
    return row ? hotelFromRow(row) : null;
  }

  updateDiscovery(id: OtaHotel['id'], update: OtaHotelDiscoveryUpdate): OtaHotel {
    const result = this.database
      .prepare(
        `UPDATE ota_hotel
         SET credential_id = @credentialId,
             ota_hotel_name = @otaHotelName,
             bind_extra = @bindExtra,
             discovered_at = @discoveredAt,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = @id`,
      )
      .run({ ...update, id, bindExtra: serializeJsonObject(update.bindExtra) });
    if (result.changes === 0) throw new Error('未找到 OtaHotel');
    const row = this.database
      .prepare<[string], OtaHotelRow>(`SELECT ${SELECT_COLUMNS} FROM ota_hotel WHERE id = ?`)
      .get(id);
    if (!row) throw new Error('未找到 OtaHotel');
    return hotelFromRow(row);
  }
}
