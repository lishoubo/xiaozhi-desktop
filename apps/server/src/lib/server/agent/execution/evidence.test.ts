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
			result: Array.from({ length: 55 }, (_, index) => ({ hotel_id: 'hotel-1', value: index }))
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
		expect(Array.isArray(evidence.data) && evidence.data).toHaveLength(50);
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
});
