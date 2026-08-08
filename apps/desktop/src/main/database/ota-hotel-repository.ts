import {
  toChannelId,
  toOtaCredentialId,
  toOtaHotelId,
  type ChannelId,
  type OtaHotelId,
} from '../ids';
import { type OtaHotel, type OtaHotelSaveInput } from '../../shared/types/ota-hotel';
import type { ApplicationDatabase } from './application-database';
import { parseJsonObject, serializeJsonObject } from './json-storage';

/**
 * 渠道酒店的持久化能力。接口与实现同文件：service 只 import 这个类型，
 * eslint 已禁止它们 import 下面的实现类。
 *
 * 只有 `save()` 一个写入口，由用户确认触发——探测阶段不写库。
 */
export interface OtaHotelRepository {
  save(input: OtaHotelSaveInput): OtaHotel;
  findByChannelAndHotelId(channel: ChannelId, otaHotelId: OtaHotelId): OtaHotel | null;
}

type OtaHotelRow = Readonly<{
  id: string;
  credentialId: string;
  channel: string;
  otaHotelId: string;
  otaHotelName: string | null;
  bindExtra: string | null;
}>;

function hotelFromRow(row: OtaHotelRow): OtaHotel {
  return {
    id: row.id,
    credentialId: toOtaCredentialId(row.credentialId),
    channel: toChannelId(row.channel),
    otaHotelId: toOtaHotelId(row.otaHotelId),
    otaHotelName: row.otaHotelName,
    bindExtra: parseJsonObject(row.bindExtra, 'bindExtra'),
  };
}

const SELECT_COLUMNS = `
  id,
  credential_id AS credentialId,
  channel,
  ota_hotel_id AS otaHotelId,
  ota_hotel_name AS otaHotelName,
  bind_extra AS bindExtra
`;

export class SqliteOtaHotelRepository implements OtaHotelRepository {
  constructor(private readonly database: ApplicationDatabase) {}

  /**
   * 按 `(channel, otaHotelId)` upsert。同一家渠道酒店在本地只存一条：已存在时
   * 改指本次凭证并刷新酒店信息，记录 `id` 保持不变（入参里的 `id` 被忽略）。
   * 用单条 `ON CONFLICT` 而非「先查再决定」，避免两次往返之间的竞态。
   *
   * 改指最新凭证是有意的：同一家店应跟随最近一次成功探测的登录态，否则旧凭证
   * 失效后这家店就无法再被操作。
   */
  save(input: OtaHotelSaveInput): OtaHotel {
    const row = this.database
      .prepare<Record<string, unknown>, OtaHotelRow>(
        `INSERT INTO ota_hotel
          (id, credential_id, channel, ota_hotel_id, ota_hotel_name, bind_extra)
         VALUES
          (@id, @credentialId, @channel, @otaHotelId, @otaHotelName, @bindExtra)
         ON CONFLICT(channel, ota_hotel_id) DO UPDATE SET
           credential_id = excluded.credential_id,
           ota_hotel_name = excluded.ota_hotel_name,
           bind_extra = excluded.bind_extra,
           updated_at = CURRENT_TIMESTAMP
         RETURNING ${SELECT_COLUMNS}`,
      )
      .get({ ...input, bindExtra: serializeJsonObject(input.bindExtra) });
    if (!row) throw new Error('保存 OtaHotel 失败');
    return hotelFromRow(row);
  }

  findByChannelAndHotelId(channel: ChannelId, otaHotelId: OtaHotelId): OtaHotel | null {
    const row = this.database
      .prepare<[string, string], OtaHotelRow>(
        `SELECT ${SELECT_COLUMNS} FROM ota_hotel WHERE channel = ? AND ota_hotel_id = ?`,
      )
      .get(channel, otaHotelId);
    return row ? hotelFromRow(row) : null;
  }
}
