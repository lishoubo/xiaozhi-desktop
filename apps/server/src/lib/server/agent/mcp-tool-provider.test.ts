import { describe, expect, it, vi } from 'vitest';
import {
	isReadOnlyMcpToolName,
	loadMcpServerToolsInOrder,
	makeServerInjectedDatabaseIdOptional,
	McpToolProvider,
	selectMcpServersByCapabilities
} from './mcp-tool-provider';
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

type MockMcpClient = {
	getTools: ReturnType<typeof vi.fn>;
	close: ReturnType<typeof vi.fn>;
};

const mcpClientState = vi.hoisted<{ instances: MockMcpClient[] }>(() => ({ instances: [] }));

vi.mock('@langchain/mcp-adapters', () => ({
	MultiServerMCPClient: class {
		readonly getTools = vi.fn().mockResolvedValue([
			{
				name: 'executeScript',
				description: 'execute SQL',
				schema: {},
				invoke: vi.fn()
			}
		]);
		readonly close = vi.fn().mockResolvedValue(undefined);

		constructor() {
			mcpClientState.instances.push(this);
		}
	}
}));

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

describe('selectMcpServersByCapabilities', () => {
	it('selects only explicitly authorized capabilities and denies an empty allowlist', () => {
		const servers = {
			weather: {
				transport: 'stdio' as const,
				command: 'node',
				args: [],
				capabilities: ['weather' as const]
			},
			dms: {
				transport: 'sse' as const,
				url: 'https://example.com/dms',
				capabilities: ['hotel_data' as const]
			}
		};

		expect(Object.keys(selectMcpServersByCapabilities(servers, []))).toEqual([]);
		expect(Object.keys(selectMcpServersByCapabilities(servers, ['hotel_data']))).toEqual(['dms']);
	});
});

describe('McpToolProvider connection refresh', () => {
	it('closes the cached client and reloads tools for the requested capabilities', async () => {
		mcpClientState.instances.length = 0;
		const provider = new McpToolProvider(
			{
				'aliyun-dms-hotel-data': {
					transport: 'sse',
					url: 'https://example.com/dms',
					capabilities: ['hotel_data']
				}
			},
			'81918192'
		);

		const cached = await provider.getTools(['hotel_data']);
		await expect(provider.getTools(['hotel_data'])).resolves.toBe(cached);
		const refreshed = await provider.refreshTools(['hotel_data']);

		expect(mcpClientState.instances).toHaveLength(2);
		expect(mcpClientState.instances[0]?.close).toHaveBeenCalledOnce();
		expect(refreshed).not.toBe(cached);
		expect(refreshed.map((candidate) => candidate.name)).toContain(
			'query_hotel_operating_data_sql'
		);
		await provider.close();
		expect(mcpClientState.instances[1]?.close).toHaveBeenCalledOnce();
	});
});

describe('hotel data MCP guardrails', () => {
	it('removes the model-facing database id requirement because the server injects it', () => {
		const schema = {
			type: 'object',
			properties: {
				database_id: { type: 'string', description: 'DMS databaseId' },
				script: { type: 'string' }
			},
			required: ['database_id', 'script']
		};

		makeServerInjectedDatabaseIdOptional(schema);

		expect(schema.required).toEqual(['script']);
		expect(schema.properties.database_id.description).toBe('由服务端安全注入，请勿填写或猜测');
	});

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

	it('enforces the staff managed-hotel scope before SQL execution', () => {
		const scoped = constrainHotelDataSqlArgs(
			{ script: 'SELECT hotel_id, order_id FROM ota_order WHERE hotel_id IN (9, 10)' },
			'81918192',
			['9', '10']
		);
		expect(scoped).toMatchObject({ database_id: '81918192' });
		expect(
			typeof scoped === 'object' && scoped !== null ? Reflect.get(scoped, 'script') : null
		).toContain(
			'FROM (SELECT * FROM ota_order WHERE hotel_id IN (9, 10)) AS ota_order WHERE hotel_id IN (9, 10)'
		);
		const qualified = constrainHotelDataSqlArgs(
			{ script: 'SELECT o.order_id FROM rms_data.ota_order AS o ORDER BY o.created_at DESC' },
			'81918192',
			['9'],
			'rms_data'
		);
		expect(
			typeof qualified === 'object' && qualified !== null ? Reflect.get(qualified, 'script') : null
		).toContain(
			'FROM (SELECT * FROM rms_data.ota_order WHERE hotel_id IN (9)) AS o ORDER BY o.created_at DESC'
		);
		expect(() =>
			constrainHotelDataSqlArgs(
				{ script: 'SELECT * FROM other_schema.ota_order' },
				'81918192',
				['9'],
				'rms_data'
			)
		).toThrow('目标数据库范围');
		const quotedKeyword = constrainHotelDataSqlArgs(
			{ script: "SELECT 'from ota_order where' AS marker, s.secret FROM secret_table s" },
			'81918192',
			['9'],
			'rms_data'
		);
		expect(
			typeof quotedKeyword === 'object' && quotedKeyword !== null
				? Reflect.get(quotedKeyword, 'script')
				: null
		).toContain(
			"SELECT 'from ota_order where' AS marker, s.secret FROM (SELECT * FROM secret_table WHERE hotel_id IN (9)) AS s"
		);
		for (const script of [
			'SELECT o.hotel_id, h.name FROM ota_order o JOIN hotel h ON h.id = o.hotel_id WHERE o.hotel_id = 9',
			'SELECT * FROM (SELECT * FROM ota_order WHERE hotel_id = 9) scoped_rows WHERE hotel_id = 9',
			'WITH scoped_orders AS (SELECT * FROM ota_order WHERE hotel_id = 9) SELECT * FROM scoped_orders',
			'SELECT hotel_id, order_id FROM ota_order WHERE hotel_id = 9 UNION ALL SELECT hotel_id, order_id FROM direct_order WHERE hotel_id = 9'
		]) {
			expect(() => constrainHotelDataSqlArgs({ script }, '81918192', ['9', '10'])).not.toThrow();
		}
		expect(() =>
			constrainHotelDataSqlArgs(
				{
					script:
						'SELECT s.secret FROM secret_table s, fact_business_daily f WHERE f.hotel_id = 9 AND s.active = 1'
				},
				'81918192',
				['9', '10']
			)
		).toThrow('笛卡尔');
		expect(() =>
			constrainHotelDataSqlArgs(
				{ script: 'SELECT o.order_id, h.name FROM ota_order o JOIN hotel h ON h.id = o.hotel_id' },
				'81918192',
				['9', '10']
			)
		).toThrow('酒店范围');
		expect(() =>
			constrainHotelDataSqlArgs(
				{
					script:
						'SELECT o.order_id, h.name FROM ota_order o JOIN hotel h ON h.id = o.hotel_id WHERE o.hotel_id = 99'
				},
				'81918192',
				['9', '10']
			)
		).toThrow('酒店范围');
		for (const script of [
			'SELECT o.order_id FROM ota_order o JOIN hotel h ON h.id = o.hotel_id WHERE o.hotel_id = 9 OR 1 = 1',
			'SELECT hotel_id FROM ota_order WHERE hotel_id = 9 UNION ALL SELECT hotel_id FROM ota_order'
		]) {
			expect(() => constrainHotelDataSqlArgs({ script }, '81918192', ['9', '10'])).toThrow(
				'酒店范围'
			);
		}
		const alternativeBoolean = constrainHotelDataSqlArgs(
			{
				script: 'SELECT * FROM fact_business_daily WHERE hotel_id = 9 AND 0 XOR hotel_id > 10'
			},
			'81918192',
			['9']
		);
		expect(
			typeof alternativeBoolean === 'object' && alternativeBoolean !== null
				? Reflect.get(alternativeBoolean, 'script')
				: null
		).toContain(
			'FROM (SELECT * FROM fact_business_daily WHERE hotel_id IN (9)) AS fact_business_daily'
		);
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

	it('preserves a seven-day markdown result without truncating its text block', () => {
		const markdown = `| date | gmv |\n| --- | --- |\n${Array.from(
			{ length: 7 },
			(_, index) => `| 2026-08-${String(index + 10)} | ${'1'.repeat(250)} |`
		).join('\n')}`;
		const compacted = compactHotelDataResult([{ type: 'text', text: markdown }]);

		expect(compacted).toContain('2026-08-16');
		expect(compacted).not.toContain('值已截断');
	});

	it('keeps the smaller limit for ordinary MCP free text', () => {
		const compacted = compactHotelDataResult([{ type: 'text', text: 'x'.repeat(2_000) }]);

		expect(compacted).toContain('值已截断');
		expect(compacted).not.toContain('x'.repeat(1_001));
	});
});
