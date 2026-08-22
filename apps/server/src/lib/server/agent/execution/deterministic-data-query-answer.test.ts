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
	return [
		{
			evidenceId: '11111111-1111-4111-8111-111111111111',
			source: 'aliyun_dms_mcp',
			data: { toolName: 'query_hotel_operating_data_sql', data }
		}
	];
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

	it('keeps scalar MCP evidence visible', () => {
		const result = buildDeterministicDataQueryAnswer(
			request,
			evidence({ data: 12, filtered: false })
		);

		expect(result?.ui.elements.result.props).toEqual({
			columns: ['查询结果'],
			rows: [[12]]
		});
	});

	it('renders only SQL query evidence when schema discovery evidence appears first', () => {
		const result = buildDeterministicDataQueryAnswer(request, [
			{
				evidenceId: '11111111-1111-4111-8111-111111111111',
				source: 'aliyun_dms_mcp',
				data: {
					toolName: 'list_hotel_data_tables',
					data: { TableList: { Table: [{ TableName: 'ota_order' }] } }
				}
			},
			{
				evidenceId: '22222222-2222-4222-8222-222222222222',
				source: 'aliyun_dms_mcp',
				data: {
					toolName: 'query_hotel_operating_data_sql',
					data: { data: [{ order_id: 'O-100', channel: '携程' }] }
				}
			}
		]);

		expect(result?.ui.elements.result.props).toEqual({
			columns: ['order_id', 'channel'],
			rows: [['O-100', '携程']]
		});
		expect(JSON.stringify(result)).not.toContain('TableList');
	});

	it('keeps rows from every successful SQL evidence set', () => {
		const result = buildDeterministicDataQueryAnswer(request, [
			{
				evidenceId: '33333333-3333-4333-8333-333333333333',
				source: 'aliyun_dms_mcp',
				data: {
					toolName: 'query_hotel_operating_data_sql',
					data: [{ hotel_id: 4, exposure_cnt: 100 }]
				}
			},
			{
				evidenceId: '44444444-4444-4444-8444-444444444444',
				source: 'aliyun_dms_mcp',
				data: {
					toolName: 'query_hotel_operating_data_sql',
					data: [{ hotel_id: 4, keyword: '包头酒店' }]
				}
			}
		]);

		expect(result?.content).toContain('2 组');
		expect(result?.ui.elements['table-1']?.props).toEqual({
			columns: ['hotel_id', 'exposure_cnt'],
			rows: [[4, 100]]
		});
		expect(result?.ui.elements['table-2']?.props).toEqual({
			columns: ['hotel_id', 'keyword'],
			rows: [[4, '包头酒店']]
		});
	});

	it('reserves display capacity for every SQL result set and uses provenance labels', () => {
		const result = buildDeterministicDataQueryAnswer(request, [
			{
				evidenceId: '55555555-5555-4555-8555-555555555555',
				source: 'aliyun_dms_mcp',
				data: {
					toolName: 'query_hotel_operating_data_sql',
					provenance: { domains: ['traffic_conversion'], tables: ['fact_traffic_scene'] },
					data: Array.from({ length: 75 }, (_, index) => ({ exposure_cnt: index + 1 }))
				}
			},
			{
				evidenceId: '66666666-6666-4666-8666-666666666666',
				source: 'aliyun_dms_mcp',
				data: {
					toolName: 'query_hotel_operating_data_sql',
					provenance: { domains: ['search'], tables: ['fact_search_keyword'] },
					data: [{ keyword: '包头酒店' }]
				}
			}
		]);

		const serialized = JSON.stringify(result?.ui);
		expect(serialized).toContain('流量与转化 · fact_traffic_scene');
		expect(serialized).toContain('搜索 · fact_search_keyword');
		expect(serialized).toContain('包头酒店');
	});
});
