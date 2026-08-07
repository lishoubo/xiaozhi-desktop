import {
  toChannelId,
  toOtaCredentialId,
  toOtaHotelId,
  toOtaHotelProbId,
  type ChannelId,
  type OtaCredentialId,
  type OtaHotelId,
} from '../../domain/identity';
import {
  createOtaHotelProb,
  type OtaHotelProb,
  type OtaHotelProbCreateInput,
  type OtaHotelProbDiscoveryUpdate,
} from '../../domain/ota-hotel-prob';
import type { OtaHotelProbRepository } from '../../domain/ports/repositories';
import type { ApplicationDatabase } from './application-database';
import { parseJsonObject, serializeJsonObject } from './json-storage';

type OtaHotelProbRow = Readonly<{
  id: string;
  credentialId: string;
  channel: string;
  otaHotelId: string;
  otaHotelName: string | null;
  bindExtra: string | null;
  discoveredAt: number;
}>;

function hotelProbFromRow(row: OtaHotelProbRow): OtaHotelProb {
  return createOtaHotelProb({
    id: toOtaHotelProbId(row.id),
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

export class SqliteOtaHotelProbRepository implements OtaHotelProbRepository {
  constructor(private readonly database: ApplicationDatabase) {}

  create(input: OtaHotelProbCreateInput): OtaHotelProb {
    const hotelProb = createOtaHotelProb(input);
    this.database
      .prepare(
        `INSERT INTO ota_hotel_prob
          (id, credential_id, channel, ota_hotel_id, ota_hotel_name, bind_extra, discovered_at)
         VALUES
          (@id, @credentialId, @channel, @otaHotelId, @otaHotelName, @bindExtra, @discoveredAt)`,
      )
      .run({ ...hotelProb, bindExtra: serializeJsonObject(hotelProb.bindExtra) });
    return hotelProb;
  }

  findByChannelAndHotelId(channel: ChannelId, otaHotelId: OtaHotelId): OtaHotelProb | null {
    const row = this.database
      .prepare<[string, string], OtaHotelProbRow>(
        `SELECT ${SELECT_COLUMNS} FROM ota_hotel_prob WHERE channel = ? AND ota_hotel_id = ?`,
      )
      .get(channel, otaHotelId);
    return row ? hotelProbFromRow(row) : null;
  }

  findByCredentialId(credentialId: OtaCredentialId): OtaHotelProb | null {
    const row = this.database
      .prepare<[string], OtaHotelProbRow>(
        `SELECT ${SELECT_COLUMNS} FROM ota_hotel_prob WHERE credential_id = ?`,
      )
      .get(credentialId);
    return row ? hotelProbFromRow(row) : null;
  }

  updateDiscovery(id: OtaHotelProb['id'], update: OtaHotelProbDiscoveryUpdate): OtaHotelProb {
    const result = this.database
      .prepare(
        `UPDATE ota_hotel_prob
         SET credential_id = @credentialId,
             ota_hotel_name = @otaHotelName,
             bind_extra = @bindExtra,
             discovered_at = @discoveredAt,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = @id`,
      )
      .run({ ...update, id, bindExtra: serializeJsonObject(update.bindExtra) });
    if (result.changes === 0) throw new Error('未找到 OtaHotelProb');
    const row = this.database
      .prepare<[string], OtaHotelProbRow>(
        `SELECT ${SELECT_COLUMNS} FROM ota_hotel_prob WHERE id = ?`,
      )
      .get(id);
    if (!row) throw new Error('未找到 OtaHotelProb');
    return hotelProbFromRow(row);
  }
}
