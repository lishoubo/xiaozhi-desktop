import { describe, expect, it } from 'vitest';
import {
	buildHotelDataCatalogDriftSql,
	expectedHotelDataObjectCount
} from './hotel-data-catalog-drift';

describe('hotel data catalog drift audit', () => {
	it('builds one read-only information-schema comparison for every verified object', () => {
		const sql = buildHotelDataCatalogDriftSql();

		expect(expectedHotelDataObjectCount()).toBe(35);
		expect(sql).toContain('information_schema.COLUMNS');
		expect(sql).toContain("'data_sync_subscription' AS table_name, 14 AS cached_count");
		expect(sql).toContain("'v_hotel_current' AS table_name, 10 AS cached_count");
		expect(sql).toContain('HAVING live_count <> expected.cached_count');
		expect(sql).toContain('expected.table_name IS NULL');
		expect(sql).toContain('0 AS cached_count');
		expect(sql).not.toMatch(/\b(?:UPDATE|DELETE|INSERT|DROP|ALTER)\b/i);
	});
});
