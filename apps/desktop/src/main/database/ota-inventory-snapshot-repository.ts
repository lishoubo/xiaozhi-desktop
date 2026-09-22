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

  /**
   * 删除 `beforeDate` 之前的格子，**最多删 `limit` 行**，返回实际删除行数。
   * 防止窗口滚动后旧日期无限累积。
   *
   * ⚠️ 必须带 `limit`：better-sqlite3 是同步 API，积压久了的一次无界 DELETE 会卡住
   * 主进程。调用方按返回值判断是否还有剩余（删满 `limit` 即可能还有），分批让出事件
   * 循环再删下一批 —— 见 `inventory-snapshot/snapshot-cleaner.ts`。
   */
  deleteOlderThan(beforeDate: string, limit: number): number;
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
  /** ⚠️ 老记录没有（migration 10 之后才写），读取方必须容忍 null。 */
  roomName: string | null;
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
  source_of_truth AS sourceOfTruth,
  room_name AS roomName
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
    // null（老记录）与空串都收敛成 undefined —— 调用方只需判一种「没有」。
    ...(row.roomName ? { roomName: row.roomName } : {}),
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
         item_type, item_date, item_data, content_hash, observed_at, source_of_truth,
         room_name)
      VALUES
        (@id, @source, @otaHotelId, @otaPhysicalRoomId, @otaSaleRoomId,
         @itemType, @itemDate, @itemData, @contentHash, @observedAt, @sourceOfTruth,
         @roomName)
      ON CONFLICT(source, ota_hotel_id, ota_sale_room_id, ota_physical_room_id, item_type, item_date)
      DO UPDATE SET
        item_data = excluded.item_data,
        content_hash = excluded.content_hash,
        observed_at = excluded.observed_at,
        source_of_truth = excluded.source_of_truth,
        -- ⚠️ 取不到名字时**保留旧值**，不要用 NULL 覆盖。
        --
        -- 格子键里已经含房型 ID，所以同一行的新旧名字**必然属于同一个房型** ——
        -- 保留旧名字不会张冠李戴。而写入路径里只有扫描拿得到名字（房型清单在那一步），
        -- 自然读（旁听页面响应）压根没有房型清单，直接覆盖会把扫描刚写对的名字抹掉。
        --
        -- 实测代价：2026-09-22 未加此保护时，携程 page-read 的 504 行**全部无名字**。
        room_name = COALESCE(excluded.room_name, room_name),
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
          // ⚠️ better-sqlite3 不接受 undefined 绑定，必须显式转成 null。
          // 空串也一并转成 null —— 上面的 `COALESCE` 据此保留住旧名字。
          roomName: cell.roomName || null,
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

  deleteOlderThan(beforeDate: string, limit: number): number {
    // ⚠️ 用子查询限行，不用 `DELETE ... LIMIT` —— 后者要 SQLite 编译时开
    // `SQLITE_ENABLE_UPDATE_DELETE_LIMIT`，better-sqlite3 的预编译产物默认没开，
    // 写了会在运行期报语法错误（而不是编译期）。
    const result = this.database
      .prepare(
        `DELETE FROM ota_inventory_snapshot WHERE id IN (
           SELECT id FROM ota_inventory_snapshot WHERE item_date < ? LIMIT ?
         )`,
      )
      .run(beforeDate, limit);
    return result.changes;
  }
}
