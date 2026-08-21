import { describe, expect, it } from 'vitest';
import {
	assessEvidence,
	normalizeEvidence,
	parseEvidenceResult,
	restoreEvidenceEnvelope
} from './evidence';

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
	it('restores a persisted envelope for retry without changing its scope', () => {
		const envelope = normalizeEvidence({
			request,
			toolName: 'query_hotel_operating_data_sql',
			toolArgs: { script: 'SELECT hotel_id, data_date FROM fact_business_daily' },
			result: [{ hotel_id: 'hotel-1', data_date: '2026-07-01' }]
		});

		expect(
			restoreEvidenceEnvelope({
				evidenceId: envelope.evidenceId,
				source: envelope.source,
				data: envelope
			})
		).toEqual(envelope);
	});

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
			toolName: 'query_hotel_operating_data_sql',
			toolArgs: { question: 'query' },
			result: Array.from({ length: 80 }, (_, index) => ({ hotel_id: 'hotel-1', value: index }))
		});

		expect(evidence).toMatchObject({
			source: 'aliyun_dms_mcp',
			toolName: 'query_hotel_operating_data_sql',
			scope: {
				hotelReference: 'hotel-1',
				period: null
			},
			requestedScope: {
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

	it('keeps different results distinct when streamed tool arguments are unavailable', () => {
		const first = normalizeEvidence({
			request,
			toolName: 'query_hotel_operating_data_sql',
			toolArgs: null,
			result: [{ hotel_id: 'hotel-1', data_date: '2026-07-01', exposure_cnt: 10 }]
		});
		const second = normalizeEvidence({
			request,
			toolName: 'query_hotel_operating_data_sql',
			toolArgs: null,
			result: [{ hotel_id: 'hotel-1', data_date: '2026-07-01', visit_cnt: 5 }]
		});
		const repeated = normalizeEvidence({
			request,
			toolName: 'query_hotel_operating_data_sql',
			toolArgs: null,
			result: [{ hotel_id: 'hotel-1', data_date: '2026-07-01', exposure_cnt: 10 }]
		});

		expect(first.queryFingerprint).not.toBe(second.queryFingerprint);
		expect(first.queryFingerprint).toBe(repeated.queryFingerprint);
	});

	it('uses result identity when a streamed SQL call only captured non-query arguments', () => {
		const first = normalizeEvidence({
			request,
			toolName: 'query_hotel_operating_data_sql',
			toolArgs: { database_id: 'db' },
			result: [{ hotel_id: 'hotel-1', exposure_cnt: 10 }]
		});
		const second = normalizeEvidence({
			request,
			toolName: 'query_hotel_operating_data_sql',
			toolArgs: { database_id: 'db' },
			result: [{ hotel_id: 'hotel-1', visit_cnt: 5 }]
		});

		expect(first.queryFingerprint).not.toBe(second.queryFingerprint);
	});

	it('canonicalizes tool argument key order for stable query deduplication', () => {
		const first = normalizeEvidence({
			request,
			toolName: 'query_hotel_operating_data_sql',
			toolArgs: { database_id: 'db', script: 'SELECT 1' },
			result: [{ value: 1 }]
		});
		const repeated = normalizeEvidence({
			request,
			toolName: 'query_hotel_operating_data_sql',
			toolArgs: { script: 'SELECT 1', database_id: 'db' },
			result: [{ value: 1 }]
		});

		expect(first.queryFingerprint).toBe(repeated.queryFingerprint);
	});

	it('does not treat requested hotel or date as observed scope', () => {
		const evidence = normalizeEvidence({
			request,
			toolName: 'query_hotel_operating_data_sql',
			toolArgs: { script: 'SELECT SUM(gmv) AS gmv FROM fact_business_daily' },
			result: '| gmv |\n| --- |\n| 100 |'
		});

		expect(evidence.scope).toEqual({ hotelReference: null, period: null });
		expect(assessEvidence(request, [evidence], false)).toEqual({
			status: 'needs_more_data',
			limitation: '查询结果未返回可验证的酒店范围。'
		});
	});

	it('accepts a server-enforced hotel scope when an aggregate result omits hotel_id', () => {
		const evidence = normalizeEvidence({
			request,
			toolName: 'query_hotel_operating_data_sql',
			toolArgs: { script: 'SELECT SUM(exposure_cnt) FROM fact_traffic_scene' },
			result: [{ exposure_cnt: 100 }],
			verifiedHotelScope: ['hotel-1']
		});

		expect(evidence.scope.hotelReference).toBe('hotel-1');
		expect(assessEvidence(request, [evidence], false)).toEqual({
			status: 'needs_more_data',
			limitation: '查询结果未返回可验证的业务日期范围。'
		});
	});

	it('keeps scoped current data visible when the result proves freshness but omits hotel_id', () => {
		const currentRequest = {
			...request,
			responseMode: 'data_only' as const,
			slots: { hotelReference: 'hotel-1', metrics: ['流量'] }
		};
		const evidence = normalizeEvidence({
			request: currentRequest,
			toolName: 'query_hotel_operating_data_sql',
			toolArgs: { script: 'SELECT MAX(data_date), SUM(exposure_cnt) FROM fact_traffic_scene' },
			result: [{ latest_data_date: '2026-08-20', exposure_cnt: 100 }],
			verifiedHotelScope: ['hotel-1']
		});

		expect(assessEvidence(currentRequest, [evidence], false)).toMatchObject({
			status: 'sufficient'
		});
	});

	it('does not let an execution-scope attestation override a conflicting result hotel', () => {
		const evidence = normalizeEvidence({
			request,
			toolName: 'query_hotel_operating_data_sql',
			toolArgs: { script: 'SELECT hotel_id, data_date FROM fact_traffic_scene' },
			result: [{ hotel_id: 'hotel-2', data_date: '2026-07-01' }],
			verifiedHotelScope: ['hotel-1']
		});

		expect(evidence.scope.hotelReference).toBe('hotel-2');
		expect(assessEvidence(request, [evidence], false)).toEqual({
			status: 'rejected',
			reasonCode: 'evidence_scope_mismatch'
		});

		const partiallyUnscoped = normalizeEvidence({
			request,
			toolName: 'query_hotel_operating_data_sql',
			toolArgs: { script: 'SELECT hotel_id, data_date FROM fact_traffic_scene' },
			result: [{ hotel_id: 'hotel-2', data_date: '2026-07-01' }, { data_date: '2026-07-01' }],
			verifiedHotelScope: ['hotel-1']
		});
		expect(assessEvidence(request, [partiallyUnscoped], false)).toEqual({
			status: 'rejected',
			reasonCode: 'evidence_scope_mismatch'
		});
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

	it('checks freshness and sync once before treating a generic empty query as final no-data', () => {
		const evidence = normalizeEvidence({
			request,
			toolName: 'query_hotel_operating_data_sql',
			toolArgs: { database_id: 'server-configured' },
			result:
				'[{"type":"text","text":"| hotel_id | data_date |\\n| --- | --- |","structuredContent":{"result":"| hotel_id | data_date |\\n| --- | --- |"}}]'
		});

		expect(assessEvidence(request, [evidence], false)).toEqual({
			status: 'needs_more_data',
			limitation: '目标业务数据为空，需核对最近完整业务日和同步状态。'
		});
		expect(assessEvidence(request, [evidence], true)).toEqual({ status: 'no_data' });
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
			toolName: 'query_hotel_operating_data_sql',
			toolArgs: {},
			result: [{ hotel_id: 'hotel-2', data_date: '2026-07-10', value: 1 }]
		});

		expect(assessEvidence(request, [evidence], false)).toEqual({
			status: 'rejected',
			reasonCode: 'evidence_scope_mismatch'
		});
	});

	it('accepts only evidence contained in an explicit multi-hotel scope', () => {
		const multiHotelRequest = {
			...request,
			slots: { ...request.slots, hotelReference: ['9', '10'], metrics: ['GMV'] }
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
			status: 'needs_more_data',
			limitation: '查询结果未返回可验证的酒店范围。'
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

	it('requires combined SQL evidence to cover every requested known domain', () => {
		const crossDomainRequest = {
			...request,
			slots: { ...request.slots, metrics: ['流量', '搜索词'] }
		};
		const traffic = normalizeEvidence({
			request: crossDomainRequest,
			toolName: 'query_hotel_operating_data_sql',
			toolArgs: {
				script: 'SELECT hotel_id, exposure_cnt FROM fact_traffic_scene WHERE hotel_id = 4'
			},
			result: JSON.stringify([{ hotel_id: 'hotel-1', data_date: '2026-07-10', exposure_cnt: 100 }])
		});
		const search = normalizeEvidence({
			request: crossDomainRequest,
			toolName: 'query_hotel_operating_data_sql',
			toolArgs: {
				script: 'SELECT hotel_id, keyword FROM fact_search_keyword WHERE hotel_id = 4'
			},
			result: JSON.stringify([
				{ hotel_id: 'hotel-1', data_date: '2026-07-10', keyword: '包头酒店' }
			])
		});

		expect(traffic.provenance).toMatchObject({
			tables: ['fact_traffic_scene'],
			domains: ['traffic_conversion']
		});
		expect(assessEvidence(crossDomainRequest, [traffic], false)).toMatchObject({
			status: 'sufficient',
			limitations: expect.arrayContaining(['以下请求业务域暂无可展示数据：搜索。'])
		});
		expect(assessEvidence(crossDomainRequest, [traffic, search], false)).toMatchObject({
			status: 'sufficient'
		});
	});

	it('infers domain provenance from distinctive result fields when streamed SQL args are absent', () => {
		const evidence = normalizeEvidence({
			request: { ...request, slots: { ...request.slots, metrics: '订单佣金' } },
			toolName: 'query_hotel_operating_data_sql',
			toolArgs: null,
			result: '| ota_order_no | commission_cents |\n| --- | --- |\n| O-1 | 1200 |'
		});

		expect(evidence.provenance).toMatchObject({ domains: ['orders'] });
	});

	it('requires every explicitly requested metric family, not only the broad domain', () => {
		const metricRequest = {
			...request,
			slots: {
				...request.slots,
				metrics: '分析曝光、访问、转化和成交情况'
			}
		};
		const exposureOnly = normalizeEvidence({
			request: metricRequest,
			toolName: 'query_hotel_operating_data_sql',
			toolArgs: {
				script:
					"SELECT hotel_id, data_date, exposure_cnt FROM fact_traffic_scene WHERE hotel_id = 4 AND data_date = '2026-07-10'"
			},
			result:
				'| hotel_id | data_date | exposure_cnt |\n| --- | --- | --- |\n| hotel-1 | 2026-07-10 | 100 |'
		});

		expect(assessEvidence(metricRequest, [exposureOnly], false)).toMatchObject({
			status: 'sufficient',
			limitations: expect.arrayContaining(['以下请求指标暂无可展示数据：访问、转化、成交。'])
		});
	});

	it('requires freshness proof and a comparison baseline for vague current analysis', () => {
		const currentAnalysis = {
			...request,
			responseMode: 'analysis' as const,
			slots: { hotelReference: 'hotel-1', metrics: '分析酒店流量情况' }
		};
		const latestOnly = normalizeEvidence({
			request: currentAnalysis,
			toolName: 'query_hotel_operating_data_sql',
			toolArgs: { script: 'SELECT hotel_id, data_date, exposure_cnt FROM fact_traffic_scene' },
			result:
				'| hotel_id | data_date | exposure_cnt |\n| --- | --- | --- |\n| hotel-1 | 2026-08-20 | 100 |'
		});
		const complete = normalizeEvidence({
			request: currentAnalysis,
			toolName: 'query_hotel_operating_data_sql',
			toolArgs: { script: 'SELECT hotel_id, data_date, exposure_cnt FROM fact_traffic_scene' },
			result:
				'| hotel_id | data_date | latest_data_date | exposure_cnt |\n| --- | --- | --- | --- |\n| hotel-1 | 2026-08-14 | 2026-08-20 | 80 |\n| hotel-1 | 2026-08-20 | 2026-08-20 | 100 |'
		});
		const noFreshnessProof = normalizeEvidence({
			request: currentAnalysis,
			toolName: 'query_hotel_operating_data_sql',
			toolArgs: { script: 'SELECT hotel_id, data_date, exposure_cnt FROM fact_traffic_scene' },
			result:
				'| hotel_id | data_date | exposure_cnt |\n| --- | --- | --- |\n| hotel-1 | 2026-08-20 | 100 |'
		});

		expect(assessEvidence(currentAnalysis, [latestOnly], false)).toEqual({
			status: 'sufficient',
			limitations: [
				'结果未证明最近完整业务日，不能视为当前或最新数据。',
				'结果缺少可比基线，仅展示现有数据，不输出趋势、异常或阶段变化结论。'
			]
		});
		expect(
			assessEvidence(
				{ ...currentAnalysis, slots: { hotelReference: 'hotel-1', metrics: '评估一下业绩' } },
				[latestOnly],
				false
			)
		).toEqual({
			status: 'sufficient',
			limitations: [
				'结果未证明最近完整业务日，不能视为当前或最新数据。',
				'结果缺少可比基线，仅展示现有数据，不输出趋势、异常或阶段变化结论。'
			]
		});
		expect(assessEvidence(currentAnalysis, [complete], false)).toMatchObject({
			status: 'sufficient'
		});
		expect(
			assessEvidence({ ...currentAnalysis, responseMode: 'data_only' }, [noFreshnessProof], false)
		).toEqual({
			status: 'sufficient',
			limitations: ['结果未证明最近完整业务日，不能视为当前或最新数据。']
		});
		expect(
			assessEvidence({ ...currentAnalysis, responseMode: 'data_only' }, [complete], false)
		).toMatchObject({ status: 'sufficient' });
		expect(
			assessEvidence(
				{ ...currentAnalysis, intent: 'hotel_operating_summary' as const },
				[complete],
				false
			)
		).toMatchObject({ status: 'sufficient' });
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

	it('normalizes aggregate Markdown dates and allows in-range partial coverage with a limitation', () => {
		const monthlyRequest = {
			...request,
			intent: 'hotel_operating_summary' as const,
			slots: {
				hotelReference: '4',
				dateRange: { start: '2026-08-01', end: '2026-08-21' }
			}
		};
		const evidence = normalizeEvidence({
			request: monthlyRequest,
			toolName: 'query_hotel_operating_data_sql',
			toolArgs: {
				script: 'SELECT hotel_id, MIN(data_date) AS period_start FROM fact_business_daily'
			},
			result:
				'| hotel_id | period_start | period_end | gmv |\n| --- | --- | --- | --- |\n| 4 | 2026-08-01 | 2026-08-20 | 100 |'
		});

		expect(evidence.scope.period).toEqual({ start: '2026-08-01', end: '2026-08-20' });
		expect(assessEvidence(monthlyRequest, [evidence], false)).toMatchObject({
			status: 'sufficient',
			limitations: [expect.stringContaining('当前可验证数据覆盖 2026-08-01 至 2026-08-20')]
		});
	});

	it('discloses missing interior dates for a daily trend without blocking the available rows', () => {
		const trendRequest = {
			...request,
			intent: 'hotel_operating_summary' as const,
			responseMode: 'analysis' as const,
			slots: {
				hotelReference: '4',
				dateRange: { start: '2026-08-10', end: '2026-08-12' },
				metrics: '@metrics:daily-trend'
			}
		};
		const evidence = normalizeEvidence({
			request: trendRequest,
			toolName: 'query_hotel_operating_data_sql',
			toolArgs: { script: 'SELECT hotel_id, data_date, gmv FROM fact_business_daily' },
			result:
				'| hotel_id | data_date | gmv |\n| --- | --- | --- |\n| 4 | 2026-08-10 | 100 |\n| 4 | 2026-08-12 | 120 |'
		});

		expect(assessEvidence(trendRequest, [evidence], false)).toMatchObject({
			status: 'sufficient',
			limitations: expect.arrayContaining([
				expect.stringContaining('共 3 个自然日，当前仅返回 2 个可验证日期')
			])
		});
	});

	it('keeps freshness dates separate from the requested business period', () => {
		const evidence = normalizeEvidence({
			request,
			toolName: 'query_hotel_operating_data_sql',
			toolArgs: {
				script: 'SELECT hotel_id, data_date, latest_data_date, gmv FROM fact_business_daily'
			},
			result: [
				{ hotel_id: 'hotel-1', data_date: '2026-07-10', latest_data_date: '2026-08-20', gmv: 100 }
			]
		});

		expect(evidence.scope.period).toEqual({ start: '2026-07-10', end: '2026-07-10' });
		expect(assessEvidence(request, [evidence], false)).toMatchObject({ status: 'sufficient' });
	});

	it('does not accept a null freshness column as proof and still exposes covered data', () => {
		const currentRequest = {
			...request,
			responseMode: 'analysis' as const,
			slots: { hotelReference: 'hotel-1' }
		};
		const evidence = normalizeEvidence({
			request: currentRequest,
			toolName: 'query_hotel_operating_data_sql',
			toolArgs: {
				script: 'SELECT hotel_id, data_date, latest_data_date, exposure_cnt FROM fact_traffic_scene'
			},
			result: [
				{ hotel_id: 'hotel-1', data_date: '2026-08-14', latest_data_date: null, exposure_cnt: 80 },
				{ hotel_id: 'hotel-1', data_date: '2026-08-20', latest_data_date: null, exposure_cnt: 100 }
			]
		});

		expect(assessEvidence(currentRequest, [evidence], false)).toMatchObject({
			status: 'sufficient',
			limitations: ['结果未证明最近完整业务日，不能视为当前或最新数据。']
		});
	});

	it('does not treat aggregate period endpoints as a comparison baseline', () => {
		const currentRequest = {
			...request,
			responseMode: 'analysis' as const,
			slots: { hotelReference: 'hotel-1' }
		};
		const evidence = normalizeEvidence({
			request: currentRequest,
			toolName: 'query_hotel_operating_data_sql',
			toolArgs: { script: 'SELECT hotel_id, MIN(data_date), MAX(data_date), SUM(gmv)' },
			result: [
				{
					hotel_id: 'hotel-1',
					period_start: '2026-08-01',
					period_end: '2026-08-20',
					latest_data_date: '2026-08-20',
					gmv: 100
				}
			]
		});

		expect(assessEvidence(currentRequest, [evidence], false)).toMatchObject({
			status: 'sufficient',
			limitations: ['结果缺少可比基线，仅展示现有数据，不输出趋势、异常或阶段变化结论。']
		});
	});

	it('allows a verified subset of requested hotels and identifies missing hotels', () => {
		const multiRequest = {
			...request,
			slots: { ...request.slots, hotelReference: ['hotel-1', 'hotel-2'] }
		};
		const evidence = normalizeEvidence({
			request: multiRequest,
			toolName: 'query_hotel_operating_data_sql',
			toolArgs: { script: 'SELECT hotel_id, data_date, gmv FROM fact_business_daily' },
			result: [{ hotel_id: 'hotel-1', data_date: '2026-07-10', gmv: 100 }]
		});

		expect(assessEvidence(multiRequest, [evidence], false)).toMatchObject({
			status: 'sufficient',
			limitations: expect.arrayContaining([expect.stringContaining('1 家酒店没有可展示记录')])
		});
	});

	it('uses actual row fields instead of metadata keys for metric coverage', () => {
		const evidence = normalizeEvidence({
			request,
			toolName: 'query_hotel_operating_data_sql',
			toolArgs: null,
			result: {
				columns: { gmv: 'decimal' },
				rows: [{ hotel_id: 'hotel-1', data_date: '2026-07-10', booking_amount: 50 }]
			}
		});

		expect(evidence.provenance?.resultFields).toEqual(['hotel_id', 'data_date', 'booking_amount']);
	});

	it('recognizes structured empty rows as no data', () => {
		const evidence = normalizeEvidence({
			request,
			toolName: 'query_hotel_operating_data_sql',
			toolArgs: {},
			result: { rows: [] }
		});

		expect(assessEvidence(request, [evidence], true)).toEqual({ status: 'no_data' });
	});

	it('applies language-neutral protocol metric requirements as display limitations', () => {
		const protocolRequest = {
			...request,
			slots: { ...request.slots, metrics: '@metrics:operating-summary' }
		};
		const evidence = normalizeEvidence({
			request: protocolRequest,
			toolName: 'query_hotel_operating_data_sql',
			toolArgs: { script: 'SELECT hotel_id, data_date, gmv FROM fact_business_daily' },
			result: [{ hotel_id: 'hotel-1', data_date: '2026-07-10', gmv: 100 }]
		});

		expect(assessEvidence(protocolRequest, [evidence], false)).toMatchObject({
			status: 'sufficient',
			limitations: expect.arrayContaining([
				expect.stringContaining('预约金额、核销金额、退款金额、间夜量、核销单价')
			])
		});
	});
});
