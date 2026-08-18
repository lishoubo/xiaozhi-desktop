import type { EvidenceRecord, ResolvedBusinessRequest } from './business-execution-state';
import { describe, expect, it } from 'vitest';
import { buildDeterministicDataQueryAnswer } from './deterministic-data-query-answer';

const request: ResolvedBusinessRequest = {
	routeKind: 'business_read',
	intent: 'generic_hotel_data_query',
	responseMode: 'data_only',
	slots: {}
};

function evidence(data: EvidenceRecord['data']): EvidenceRecord[] {
	return [{ evidenceId: '11111111-1111-4111-8111-111111111111', source: 'aliyun_dms_mcp', data }];
}

describe('buildDeterministicDataQueryAnswer', () => {
	it('renders structured MCP rows without a final analysis model', () => {
		const result = buildDeterministicDataQueryAnswer(
			request,
			evidence({
				data: [
					{ order_id: 'C-102', channel: '携程', created_at: '2026-08-18 08:30:00' },
					{ order_id: 'C-101', channel: '携程', created_at: '2026-08-18 08:20:00' }
				],
				filtered: false
			})
		);

		expect(result?.content).toContain('已查询到 2 条酒店数据记录');
		expect(result?.content).toContain('阿里云 DMS MCP');
		expect(result?.ui.elements.result).toMatchObject({
			type: 'Table',
			props: {
				columns: ['order_id', 'channel', 'created_at'],
				rows: [
					['C-102', '携程', '2026-08-18 08:30:00'],
					['C-101', '携程', '2026-08-18 08:20:00']
				]
			}
		});
	});

	it('renders a markdown table returned by an MCP adapter', () => {
		const result = buildDeterministicDataQueryAnswer(
			request,
			evidence({
				data: '| order_id | channel |\n| --- | --- |\n| C-102 | 携程 |',
				filtered: false
			})
		);

		expect(result?.ui.elements.result.props).toEqual({
			columns: ['order_id', 'channel'],
			rows: [['C-102', '携程']]
		});
	});

	it('renders non-tabular MCP evidence without invoking an analysis model', () => {
		const result = buildDeterministicDataQueryAnswer(
			request,
			evidence({ data: '查询完成', filtered: false })
		);

		expect(result?.ui.elements.result.props).toEqual({
			columns: ['查询结果'],
			rows: [['查询完成']]
		});
	});
});
