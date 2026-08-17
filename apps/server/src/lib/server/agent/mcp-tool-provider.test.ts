import { describe, expect, it, vi } from 'vitest';
import { isReadOnlyMcpToolName, loadMcpServerToolsInOrder } from './mcp-tool-provider';
import { summarizeMcpResult } from './mcp-observability';
import {
	compactHotelDataResult,
	constrainHotelDataGenerateSqlArgs,
	constrainHotelDataSqlArgs,
	constrainHotelDataTableDetailArgs,
	constrainHotelDataTableListArgs,
	isAllowedHotelDataMcpToolName,
	resolveDmsDatabaseId,
	selectDmsDatabaseId
} from './hotel-data-mcp';

describe('isReadOnlyMcpToolName', () => {
	it('allows explicit read operations', () => {
		expect(isReadOnlyMcpToolName('reservation.list')).toBe(true);
		expect(isReadOnlyMcpToolName('inventory-check')).toBe(true);
	});

	it('rejects disguised or explicit write operations', () => {
		expect(isReadOnlyMcpToolName('reservation.get_and_delete')).toBe(false);
		expect(isReadOnlyMcpToolName('inventory.update')).toBe(false);
		expect(isReadOnlyMcpToolName('refund.execute')).toBe(false);
	});
});

describe('loadMcpServerToolsInOrder', () => {
	it('starts independent catalogs concurrently and preserves configured order', async () => {
		const releases = new Map<string, (tools: readonly string[]) => void>();
		const load = vi.fn(
			(name: string) =>
				new Promise<readonly string[]>((resolve) => {
					releases.set(name, resolve);
				})
		);

		const loading = loadMcpServerToolsInOrder(['weather', 'hotel-data'], load);
		expect(load).toHaveBeenCalledTimes(2);

		releases.get('hotel-data')?.(['hotel-tool']);
		releases.get('weather')?.(['weather-tool']);

		await expect(loading).resolves.toEqual([['weather-tool'], ['hotel-tool']]);
	});
});

describe('hotel data MCP guardrails', () => {
	it('summarizes MCP responses without retaining business content', () => {
		const summary = summarizeMcpResult({
			content: [{ type: 'text', text: '酒店收入 123456，客人手机号 13800138000' }],
			isError: false
		});

		expect(summary).toMatchObject({
			resultType: 'object',
			contentBlockCount: 1,
			protocolStatus: 'success',
			resultFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/)
		});
		expect(summary.resultCharacterCount).toBeGreaterThan(0);
		expect(JSON.stringify(summary)).not.toContain('123456');
		expect(JSON.stringify(summary)).not.toContain('13800138000');
	});

	it('allows only read-oriented DMS data tools and blocks management tools', () => {
		expect(isAllowedHotelDataMcpToolName('searchDatabase')).toBe(true);
		expect(isAllowedHotelDataMcpToolName('askDatabase')).toBe(false);
		expect(isAllowedHotelDataMcpToolName('generateSql')).toBe(true);
		expect(isAllowedHotelDataMcpToolName('executeScript')).toBe(true);
		expect(isAllowedHotelDataMcpToolName('listTables')).toBe(true);
		expect(isAllowedHotelDataMcpToolName('getTableDetailInfo')).toBe(true);
		expect(isAllowedHotelDataMcpToolName('addInstance')).toBe(false);
		expect(isAllowedHotelDataMcpToolName('createDataChangeOrder')).toBe(false);
		expect(isAllowedHotelDataMcpToolName('submitOrderApproval')).toBe(false);
	});

	it('selects only an exact database name and verifies an optional pinned id', () => {
		const result = [
			{ type: 'text', text: JSON.stringify({ DatabaseId: 80914652, SchemaName: 'rms' }) },
			{ type: 'text', text: JSON.stringify({ DatabaseId: 81918192, SchemaName: 'rms_data' }) },
			{ structuredContent: { DatabaseId: 81918192, SchemaName: 'rms_data' } }
		];

		expect(selectDmsDatabaseId(result, 'rms_data', '81918192')).toBe('81918192');
		expect(() => selectDmsDatabaseId(result, 'rms', '81918192')).toThrow('does not match');
		expect(() => selectDmsDatabaseId(result, 'missing', null)).toThrow('unique exact match');
	});

	it('uses the configured database id when discovery is unavailable or returns no exact match', () => {
		expect(resolveDmsDatabaseId({ status: 'unavailable' }, 'rms_data', '81918192')).toEqual({
			databaseId: '81918192',
			source: 'configured_fallback'
		});
		expect(
			resolveDmsDatabaseId({ status: 'completed', result: [] }, 'rms_data', '81918192')
		).toEqual({ databaseId: '81918192', source: 'configured_fallback' });
		expect(() => resolveDmsDatabaseId({ status: 'unavailable' }, 'rms_data', null)).toThrow(
			'AI_DMS_DATABASE_ID is not configured'
		);
	});

	it('does not fall back when discovery identifies a conflicting database id', () => {
		expect(() =>
			resolveDmsDatabaseId(
				{
					status: 'completed',
					result: [{ DatabaseId: 25280000, SchemaName: 'rms_data' }]
				},
				'rms_data',
				'81918192'
			)
		).toThrow('does not match');
	});

	it('pins generated SQL and execution to the configured DMS database', () => {
		expect(
			constrainHotelDataGenerateSqlArgs(
				{ database_id: 'attacker', question: '查询 GMV' },
				'81918192'
			)
		).toMatchObject({ database_id: '81918192', question: expect.stringContaining('最多 75 行') });
		expect(
			constrainHotelDataSqlArgs({ database_id: 'attacker', script: 'SELECT 1' }, '81918192')
		).toMatchObject({ database_id: '81918192' });
	});

	it('bounds table metadata pagination before calling DMS', () => {
		expect(constrainHotelDataTableListArgs({ page_number: 0, page_size: 10_000 })).toEqual({
			page_number: 1,
			page_size: 50
		});
		expect(constrainHotelDataTableListArgs(null, '81918192')).toEqual({
			database_id: '81918192',
			page_number: 1,
			page_size: 50
		});
	});

	it('allows table metadata only inside the discovered database schema', () => {
		expect(
			constrainHotelDataTableDetailArgs(
				{ table_guid: 'IDB_5460502873.rms_data.fact_business_daily' },
				'rms_data'
			)
		).toEqual({ table_guid: 'IDB_5460502873.rms_data.fact_business_daily' });
		expect(() =>
			constrainHotelDataTableDetailArgs(
				{ table_guid: 'IDB_1.other_schema.private_table' },
				'rms_data'
			)
		).toThrow('outside the discovered database');
	});

	it('wraps a single SELECT with a result limit', () => {
		expect(
			constrainHotelDataSqlArgs({
				script: 'SELECT hotel_id, SUM(gmv) AS gmv FROM fact_business_daily GROUP BY hotel_id'
			})
		).toEqual({
			script:
				'SELECT * FROM (SELECT hotel_id, SUM(gmv) AS gmv FROM fact_business_daily GROUP BY hotel_id) AS data_agent_result LIMIT 75'
		});
	});

	it('rejects writes, multiple statements, comments, files, locks, and dangerous functions', () => {
		for (const script of [
			'DELETE FROM ota_order',
			'SELECT 1; SELECT 2',
			'SELECT * FROM hotel -- bypass',
			"SELECT * FROM hotel INTO OUTFILE '/tmp/hotels'",
			'SELECT SLEEP(10)',
			'SELECT * FROM hotel FOR UPDATE'
		]) {
			expect(() => constrainHotelDataSqlArgs({ script })).toThrow();
		}
	});

	it('preserves business fields and filters oversized result sets before model ingestion', () => {
		const rows = Array.from({ length: 80 }, (_, index) => ({
			hotel_id: 7,
			date: `2026-08-${String(index + 1).padStart(2, '0')}`,
			revenue: index * 100,
			guest_name: `guest-${index}`,
			phone: '13800138000'
		}));

		const compacted = compactHotelDataResult(JSON.stringify(rows));

		expect(compacted).toContain('DATA_RESULT_FILTERED');
		expect(compacted).toContain('省略 5 行');
		expect(compacted).toContain('13800138000');
		expect(compacted).toContain('guest-0');
	});

	it('redacts DMS credentials even when a remote error echoes them as plain text', () => {
		const compacted = compactHotelDataResult(
			'upstream rejected DMS-1234567890abcdef-1234567890abcdef'
		);

		expect(compacted).toContain('[REDACTED_DMS_TOKEN]');
		expect(compacted).not.toContain('DMS-1234567890abcdef');
	});

	it('parses embedded MCP JSON while preserving business metadata', () => {
		const compacted = compactHotelDataResult([
			{
				type: 'text',
				text: JSON.stringify({ OwnerNames: ['Alice'], OwnerIds: [123], TableName: 'hotel' })
			}
		]);

		expect(compacted).toContain('Alice');
		expect(compacted).toContain('123');
		expect(compacted).toContain('hotel');
	});
});
