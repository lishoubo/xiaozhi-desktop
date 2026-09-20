/**
 * 价量态基线快照的持久化。接口与实现同文件：调用方只 import 接口类型，
 * eslint 已禁止它们 import 实现类（照 `ota-hotel-repository.ts`）。
 *
 * 语义与为什么需要这张表，见 `inventory-snapshot/types.ts`。
 */
import { randomUUID } from 'node:crypto';
import { serializeJsonObject, parseJsonObject } from './json-storage';
import {
  hasRoomIdentity,
  type SnapshotCell,
  type SnapshotItemType,
  type SnapshotSourceOfTruth,
} from '../inventory-snapshot/types';
import type { ApplicationDatabase } from './application-database';

export interface OtaInventorySnapshotRepository {
  /**
   * 批量 upsert。返回实际写入的格子数。
   *
   * ⚠️ 两个房型 ID 同时为空的格子会被**跳过**（不抛错、不中断整批）——这类数据定位不了房型，
   * 但它是渠道返回里的个别行，让整批失败得不偿失。调用方据返回值与入参长度之差可知有跳过。
   */
  upsertMany(cells: readonly SnapshotCell[]): number;

  /**
   * 读一批基线：某渠道某酒店在 `[startDate, endDate]` 闭区间内的全部格子。
   *
   * ⚠️ 供定时扫描「一次读一批」用（Change B）。扫描必须**取完整批数据后再一次性**
   * 读基线 + 比对 + 写入，全程不跨 `await` —— 边取边比会把「回读插队导致基线过期」的窗口
   * 拉长到整轮扫描时长，把用户自己的改动误报成外部变更。
   */
  findByHotelAndDateRange(
    source: string,
    otaHotelId: string,
    startDate: string,
    endDate: string,
  ): readonly SnapshotCell[];

  /** 删除 `beforeDate` 之前的格子，返回删除行数。防止窗口滚动后旧日期无限累积。 */
  deleteOlderThan(beforeDate: string): number;
}

type SnapshotRow = Readonly<{
  source: string;
  otaHotelId: string;
  otaPhysicalRoomId: string;
  otaSaleRoomId: string;
  itemType: string;
  itemDate: string;
  itemData: string;
  contentHash: string;
  observedAt: number;
  sourceOfTruth: string;
}>;

const SELECT_COLUMNS = `
  source,
  ota_hotel_id AS otaHotelId,
  ota_physical_room_id AS otaPhysicalRoomId,
  ota_sale_room_id AS otaSaleRoomId,
  item_type AS itemType,
  item_date AS itemDate,
  item_data AS itemData,
  content_hash AS contentHash,
  observed_at AS observedAt,
  source_of_truth AS sourceOfTruth
`;

function cellFromRow(row: SnapshotRow): SnapshotCell {
  return {
    source: row.source,
    otaHotelId: row.otaHotelId,
    otaPhysicalRoomId: row.otaPhysicalRoomId,
    otaSaleRoomId: row.otaSaleRoomId,
    // 列上有 CHECK 约束，能读出来的一定是这两个值之一。
    itemType: row.itemType as SnapshotItemType,
    itemDate: row.itemDate,
    itemData: parseJsonObject(row.itemData, 'itemData') ?? {},
    contentHash: row.contentHash,
    observedAt: row.observedAt,
    sourceOfTruth: row.sourceOfTruth as SnapshotSourceOfTruth,
  };
}

export class SqliteOtaInventorySnapshotRepository implements OtaInventorySnapshotRepository {
  constructor(private readonly database: ApplicationDatabase) {}

  /**
   * 整批包进**一个**事务：better-sqlite3 的事务把 N 次写压成一次 fsync，比逐条快一个
   * 数量级。批量写是这张表与既有 repository 最大的差别（那些都是单行写）。
   *
   * ⚠️ 事务内**不得出现 `await`** —— better-sqlite3 的事务是同步的，中间 await 会让事务
   * 跨事件循环边界，行为未定义。这也是 `upsertMany` 是同步方法的原因。
   */
  upsertMany(cells: readonly SnapshotCell[]): number {
    if (cells.length === 0) return 0;

    const statement = this.database.prepare(`
      INSERT INTO ota_inventory_snapshot
        (id, source, ota_hotel_id, ota_physical_room_id, ota_sale_room_id,
         item_type, item_date, item_data, content_hash, observed_at, source_of_truth)
      VALUES
        (@id, @source, @otaHotelId, @otaPhysicalRoomId, @otaSaleRoomId,
         @itemType, @itemDate, @itemData, @contentHash, @observedAt, @sourceOfTruth)
      ON CONFLICT(source, ota_hotel_id, ota_sale_room_id, ota_physical_room_id, item_type, item_date)
      DO UPDATE SET
        item_data = excluded.item_data,
        content_hash = excluded.content_hash,
        observed_at = excluded.observed_at,
        source_of_truth = excluded.source_of_truth,
        updated_at = CURRENT_TIMESTAMP
    `);

    return this.database.transaction((batch: readonly SnapshotCell[]) => {
      let written = 0;
      for (const cell of batch) {
        // DB 的 CHECK 会拒绝，但那会让整批事务回滚。个别脏行不该拖垮整批。
        if (!hasRoomIdentity(cell)) continue;
        statement.run({
          id: randomUUID(),
          source: cell.source,
          otaHotelId: cell.otaHotelId,
          otaPhysicalRoomId: cell.otaPhysicalRoomId,
          otaSaleRoomId: cell.otaSaleRoomId,
          itemType: cell.itemType,
          itemDate: cell.itemDate,
          itemData: serializeJsonObject(cell.itemData),
          contentHash: cell.contentHash,
          observedAt: cell.observedAt,
          sourceOfTruth: cell.sourceOfTruth,
        });
        written += 1;
      }
      return written;
    })(cells);
  }

  findByHotelAndDateRange(
    source: string,
    otaHotelId: string,
    startDate: string,
    endDate: string,
  ): readonly SnapshotCell[] {
    const rows = this.database
      .prepare<[string, string, string, string], SnapshotRow>(
        `SELECT ${SELECT_COLUMNS} FROM ota_inventory_snapshot
         WHERE source = ? AND ota_hotel_id = ? AND item_date BETWEEN ? AND ?`,
      )
      .all(source, otaHotelId, startDate, endDate);
    return rows.map(cellFromRow);
  }

  deleteOlderThan(beforeDate: string): number {
    const result = this.database
      .prepare('DELETE FROM ota_inventory_snapshot WHERE item_date < ?')
      .run(beforeDate);
    return result.changes;
  }
}
