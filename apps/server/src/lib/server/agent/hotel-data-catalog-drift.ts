import { HOTEL_DATA_TABLES } from './hotel-data-business-catalog';

export type HotelDataCatalogCount = Readonly<{
	tableName: string;
	liveColumnCount: number;
	cachedColumnCount: number;
}>;

export function buildHotelDataCatalogDriftSql(): string {
	const expectedRows = HOTEL_DATA_TABLES.map(
		(table) => `SELECT '${table.name}' AS table_name, ${table.columns.length} AS cached_count`
	).join(' UNION ALL ');
	return `SELECT drift.table_name, drift.live_count, drift.cached_count FROM (SELECT expected.table_name, COUNT(live.COLUMN_NAME) AS live_count, expected.cached_count FROM (${expectedRows}) AS expected LEFT JOIN information_schema.COLUMNS AS live ON live.TABLE_SCHEMA = 'rms_data' AND live.TABLE_NAME = expected.table_name GROUP BY expected.table_name, expected.cached_count HAVING live_count <> expected.cached_count UNION ALL SELECT live.TABLE_NAME AS table_name, COUNT(live.COLUMN_NAME) AS live_count, 0 AS cached_count FROM information_schema.COLUMNS AS live LEFT JOIN (${expectedRows}) AS expected ON expected.table_name = live.TABLE_NAME WHERE live.TABLE_SCHEMA = 'rms_data' AND expected.table_name IS NULL GROUP BY live.TABLE_NAME) AS drift ORDER BY drift.table_name`;
}

export function expectedHotelDataObjectCount(): number {
	return HOTEL_DATA_TABLES.length;
}
