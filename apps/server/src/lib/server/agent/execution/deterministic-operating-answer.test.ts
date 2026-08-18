import { describe, expect, it } from 'vitest';
import { buildDeterministicOperatingAnswer } from './deterministic-operating-answer';

const markdown = `| hotel_id | data_date | gmv | booking_amount | verified_amount | refund_amount |
| --- | --- | --- | --- | --- | --- |
| 4 | 2026-08-10 | 2618.00 | 1797.00 | 297.90 | 821.00 |
| 4 | 2026-08-11 | 2368.79 | 1235.50 | 1043.00 | 1689.79 |`;

describe('buildDeterministicOperatingAnswer', () => {
	it('builds the 7-day trend result directly from validated DMS evidence', () => {
		const result = buildDeterministicOperatingAnswer(
			{
				routeKind: 'business_read',
				intent: 'hotel_operating_summary',
				slots: {
					hotelReference: '4',
					metrics: '按日经营趋势',
					dateRange: { start: '2026-08-10', end: '2026-08-16' }
				}
			},
			[
				{
					evidenceId: '77777777-7777-4777-8777-777777777777',
					source: 'aliyun_dms_mcp',
					data: {
						data: `${JSON.stringify([{ type: 'text', text: markdown }]).slice(0, -3)}…[值已截断]`,
						filtered: true
					}
				}
			]
		);

		expect(result?.content).toContain('2026-08-10 至 2026-08-16');
		expect(result?.content).toContain('成交金额合计 4,986.79 元');
		expect(result?.ui.elements.trend).toMatchObject({
			type: 'HotelLineChart',
			props: {
				valueLabel: '成交金额',
				comparisonLabel: '核销金额',
				data: [
					{ label: '08-10', value: 2618, comparison: 297.9 },
					{ label: '08-11', value: 2368.79, comparison: 1043 }
				]
			}
		});
		expect(result?.ui.elements.detail).toMatchObject({
			type: 'Table',
			props: { columns: ['日期', '成交金额', '预约金额', '核销金额', '退款金额'] }
		});
		expect(result?.content).not.toContain('未返回指标');
	});

	it('does not present absent metrics as business zeroes', () => {
		const result = buildDeterministicOperatingAnswer(
			{
				routeKind: 'business_read',
				intent: 'hotel_operating_summary',
				slots: { hotelReference: '4', dateRange: { start: '2026-08-10', end: '2026-08-10' } }
			},
			[
				{
					evidenceId: '77777777-7777-4777-8777-777777777777',
					source: 'aliyun_dms_mcp',
					data: { data: '| hotel_id | data_date | gmv |\n| --- | --- | --- |\n| 4 | 2026-08-10 | 100 |' }
				}
			]
		);

		expect(result?.content).toContain('成交金额合计 100.00 元');
		expect(result?.content).not.toMatch(/预约金额|核销金额|退款金额/);
	});

	it('omits a metric when any participating cell is null or invalid', () => {
		const result = buildDeterministicOperatingAnswer(
			{
				routeKind: 'business_read',
				intent: 'hotel_operating_summary',
				slots: { hotelReference: '4', dateRange: { start: '2026-08-10', end: '2026-08-11' } }
			},
			[
				{
					evidenceId: '77777777-7777-4777-8777-777777777777',
					source: 'aliyun_dms_mcp',
					data: {
						data: '| hotel_id | data_date | gmv | verified_amount |\n| --- | --- | --- | --- |\n| 4 | 2026-08-10 | NULL | 20 |\n| 4 | 2026-08-11 | 900 | 30 |'
					}
				}
			]
		);

		expect(result?.content).not.toContain('成交金额合计');
		expect(result?.content).toContain('核销金额 50.00 元');
	});

	it('falls back to the answer model when evidence has no readable rows', () => {
		expect(
			buildDeterministicOperatingAnswer(
				{ routeKind: 'business_read', intent: 'hotel_operating_summary', slots: {} },
				[]
			)
		).toBeNull();
	});
});
