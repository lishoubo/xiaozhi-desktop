import { describe, expect, it } from 'vitest';
import { assessEvidence, normalizeEvidence, parseEvidenceResult } from './evidence';

const request = {
	routeKind: 'business_read' as const,
	intent: 'generic_hotel_data_query' as const,
	slots: {
		hotelReference: 'hotel-1',
		dateRange: {
			start: '2026-07-01',
			end: '2026-07-31',
			timezone: 'Asia/Shanghai',
			original: '上个月'
		},
		metrics: ['平均入住时长']
	}
};

describe('business evidence', () => {
	it('prefers structured MCP content over display text', () => {
		const parsed = parseEvidenceResult('get_weather_summary', {
			content: [{ type: 'text', text: 'display only' }],
			structuredContent: { temperatureC: 29, condition: 'overcast' }
		});

		expect(parsed).toEqual({
			quality: 'structured',
			data: { temperatureC: 29, condition: 'overcast' }
		});
	});

	it('parses JSON text from MCP content blocks', () => {
		const parsed = parseEvidenceResult('get_public_rates', {
			content: [{ type: 'text', text: '{"currency":"CNY","rates":[688]}' }]
		});

		expect(parsed).toEqual({
			quality: 'json',
			data: { currency: 'CNY', rates: [688] }
		});
	});

	it('adapts the pinned weather summary and keeps unknown prose bounded as text', () => {
		const weather = parseEvidenceResult(
			'get_weather_summary',
			"# Weather Summary\n\n**Location:** Shanghai, China (31.2, 121.4)\n\n**Time:** Aug 13, 2026, 13:15\n\n**Temperature:** 29°C\n**Today's Range:** High 31°C / Low 26°C\n**Precipitation Chance:** 80%\n**Timezone:** Asia/Shanghai"
		);
		const prose = parseEvidenceResult('unknown_read_tool', 'available rooms were returned');

		expect(weather).toMatchObject({
			quality: 'adapter',
			data: {
				format: 'weather_summary_v1',
				location: 'Shanghai, China',
				timezone: 'Asia/Shanghai',
				currentTemperatureC: 29,
				maximumTemperatureC: 31,
				minimumTemperatureC: 26,
				precipitationProbability: 80
			}
		});
		expect(prose).toEqual({ quality: 'unstructured', data: 'available rooms were returned' });
	});

	it('normalizes scope, fingerprint and filtered result metadata', () => {
		const evidence = normalizeEvidence({
			request,
			toolName: 'query_hotel_operating_data',
			toolArgs: { question: 'query' },
			result: Array.from({ length: 80 }, (_, index) => ({ hotel_id: 'hotel-1', value: index }))
		});

		expect(evidence).toMatchObject({
			source: 'aliyun_dms_mcp',
			toolName: 'query_hotel_operating_data',
			scope: {
				hotelReference: 'hotel-1',
				period: { start: '2026-07-01', end: '2026-07-31' }
			},
			metrics: ['平均入住时长'],
			parseQuality: 'structured',
			filtered: true
		});
		expect(evidence.queryFingerprint).toMatch(/^[a-f0-9]{64}$/);
		expect(Array.isArray(evidence.data) && evidence.data).toHaveLength(75);
	});

	it('allows one follow-up for empty data and becomes inconclusive afterward', () => {
		expect(assessEvidence(request, [], false)).toEqual({
			status: 'needs_more_data',
			limitation: '数据源未返回可验证数据。'
		});
		expect(assessEvidence(request, [], true)).toEqual({
			status: 'inconclusive',
			limitations: ['数据源未返回可验证数据。']
		});
	});

	it('recognizes a successful header-only hotel SQL table as a final no-data outcome', () => {
		const evidence = normalizeEvidence({
			request,
			toolName: 'query_hotel_operating_data_sql',
			toolArgs: { database_id: 'server-configured' },
			result:
				'[{"type":"text","text":"| hotel_id | data_date |\\n| --- | --- |","structuredContent":{"result":"| hotel_id | data_date |\\n| --- | --- |"}}]'
		});

		expect(assessEvidence(request, [evidence], false)).toEqual({ status: 'no_data' });
	});

	it('does not accept hotel metadata as a completed business-data query', () => {
		const metadata = normalizeEvidence({
			request,
			toolName: 'list_hotel_data_tables',
			toolArgs: {},
			result: [{ table_name: 'fact_business_daily' }]
		});

		expect(assessEvidence(request, [metadata], false)).toEqual({
			status: 'needs_more_data',
			limitation: '尚未成功执行酒店经营数据查询。'
		});
		expect(assessEvidence(request, [metadata], true)).toEqual({
			status: 'inconclusive',
			limitations: ['尚未成功执行酒店经营数据查询。']
		});
	});

	it('rejects evidence for another hotel', () => {
		const evidence = normalizeEvidence({
			request: { ...request, slots: { ...request.slots, hotelReference: 'hotel-2' } },
			toolName: 'query_hotel_operating_data',
			toolArgs: {},
			result: [{ value: 1 }]
		});

		expect(assessEvidence(request, [evidence], false)).toEqual({
			status: 'rejected',
			reasonCode: 'evidence_scope_mismatch'
		});
	});

	it('accepts only evidence contained in an explicit multi-hotel scope', () => {
		const multiHotelRequest = {
			...request,
			slots: { ...request.slots, hotelReference: ['9', '10'] }
		};
		const allowed = normalizeEvidence({
			request: multiHotelRequest,
			toolName: 'query_hotel_operating_data_sql',
			toolArgs: {},
			result:
				'| hotel_id | data_date | gmv |\n| --- | --- | --- |\n| 9 | 2026-07-10 | 100 |\n| 10 | 2026-07-10 | 200 |'
		});
		const outside = normalizeEvidence({
			request: multiHotelRequest,
			toolName: 'query_hotel_operating_data_sql',
			toolArgs: {},
			result:
				'| hotel_id | data_date | gmv |\n| --- | --- | --- |\n| 9 | 2026-07-10 | 100 |\n| 11 | 2026-07-10 | 200 |'
		});

		expect(assessEvidence(multiHotelRequest, [allowed], false)).toMatchObject({
			status: 'sufficient'
		});
		expect(assessEvidence(multiHotelRequest, [outside], false)).toEqual({
			status: 'rejected',
			reasonCode: 'evidence_scope_mismatch'
		});
		const structuredOutside = normalizeEvidence({
			request: multiHotelRequest,
			toolName: 'query_hotel_operating_data_sql',
			toolArgs: {},
			result: JSON.stringify([{ hotel_id: 9 }, { hotel_id: 11 }])
		});
		const unverifiable = normalizeEvidence({
			request: multiHotelRequest,
			toolName: 'query_hotel_operating_data_sql',
			toolArgs: {},
			result: JSON.stringify([{ order_id: 'A-1' }])
		});
		expect(assessEvidence(multiHotelRequest, [structuredOutside], false)).toEqual({
			status: 'rejected',
			reasonCode: 'evidence_scope_mismatch'
		});
		expect(assessEvidence(multiHotelRequest, [unverifiable], false)).toEqual({
			status: 'rejected',
			reasonCode: 'evidence_scope_mismatch'
		});
		for (const result of [
			JSON.stringify([{ hotel_id: 9, value: 1 }, { order_id: 'unscoped' }]),
			JSON.stringify({ query: { hotel_id: 9 }, rows: [{ order_id: 'unscoped' }] }),
			JSON.stringify({ query: { hotel_id: 9 }, row: { order_id: 'unscoped' } }),
			JSON.stringify({ query: { hotel_id: 9 }, records: { a: { order_id: 'unscoped' } } }),
			JSON.stringify({ query: { hotel_id: 9 }, summary: { total: 999 } }),
			JSON.stringify({ hotel_id: 9, rows: [{ order_id: 'unscoped' }] }),
			JSON.stringify({
				query: { hotel_id: 9 },
				columns: ['order_id'],
				rows: [['A-1']]
			})
		]) {
			const mixed = normalizeEvidence({
				request: multiHotelRequest,
				toolName: 'query_hotel_operating_data_sql',
				toolArgs: {},
				result
			});
			expect(assessEvidence(multiHotelRequest, [mixed], false)).toEqual({
				status: 'rejected',
				reasonCode: 'evidence_scope_mismatch'
			});
		}
	});

	it('rejects operating table rows outside the requested hotel or date range', () => {
		const operatingRequest = {
			...request,
			intent: 'hotel_operating_summary' as const,
			slots: { ...request.slots, hotelReference: '4' }
		};
		const evidence = normalizeEvidence({
			request: operatingRequest,
			toolName: 'query_hotel_operating_data_sql',
			toolArgs: {},
			result: '| hotel_id | data_date | gmv |\n| --- | --- | --- |\n| 99 | 2025-01-01 | 100 |'
		});

		expect(evidence.scope).toEqual({
			hotelReference: '99',
			period: { start: '2025-01-01', end: '2025-01-01' }
		});
		expect(assessEvidence(operatingRequest, [evidence], false)).toEqual({
			status: 'rejected',
			reasonCode: 'evidence_scope_mismatch'
		});
	});

	it('rejects a mixed operating table containing rows without verifiable scope', () => {
		const operatingRequest = {
			...request,
			intent: 'hotel_operating_summary' as const,
			slots: { ...request.slots, hotelReference: '4' }
		};
		const evidence = normalizeEvidence({
			request: operatingRequest,
			toolName: 'query_hotel_operating_data_sql',
			toolArgs: {},
			result:
				'| hotel_id | data_date | gmv |\n| --- | --- | --- |\n| 4 | 2026-07-10 | NULL |\n|  |  | 900 |'
		});

		expect(assessEvidence(operatingRequest, [evidence], false)).toEqual({
			status: 'rejected',
			reasonCode: 'evidence_scope_mismatch'
		});
	});
});
