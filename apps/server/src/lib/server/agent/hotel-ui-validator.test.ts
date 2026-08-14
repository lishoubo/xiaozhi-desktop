import { describe, expect, it } from 'vitest';
import { validateHotelUi } from './hotel-ui-validator';

describe('validateHotelUi', () => {
	it('accepts a hotel table at the 75-row display limit', () => {
		expect(
			validateHotelUi({
				root: 'root',
				state: {},
				elements: {
					root: {
						type: 'Table',
						props: {
							columns: ['订单', '状态'],
							rows: Array.from({ length: 75 }, (_, index) => [`A-${index + 1}`, '待确认'])
						},
						children: [],
						visible: true
					}
				}
			})
		).toHaveProperty('root', 'root');
	});

	it('rejects unregistered components and unsafe links', () => {
		expect(() =>
			validateHotelUi({
				root: 'root',
				state: {},
				elements: {
					root: { type: 'Script', props: {}, children: [], visible: true }
				}
			})
		).toThrow('component is not allowed');
		expect(() =>
			validateHotelUi({
				root: 'root',
				state: {},
				elements: {
					root: {
						type: 'Link',
						props: { href: 'javascript:alert(1)' },
						children: [],
						visible: true
					}
				}
			})
		).toThrow('links must use HTTPS');
	});

	it('accepts bounded hotel charts and rejects malformed chart props', () => {
		expect(
			validateHotelUi({
				root: 'root',
				state: {},
				elements: {
					root: {
						type: 'HotelLineChart',
						props: {
							title: '价格趋势',
							data: [
								{ label: '今天', value: 688 },
								{ label: '明天', value: 718 }
							],
							valueLabel: '公开价格',
							unit: '元',
							source: '价格 MCP'
						},
						children: [],
						visible: true
					}
				}
			})
		).toHaveProperty('root', 'root');

		expect(() =>
			validateHotelUi({
				root: 'root',
				state: {},
				elements: {
					root: {
						type: 'HotelDonutChart',
						props: { title: '过多分类', items: [] },
						children: [],
						visible: true
					}
				}
			})
		).toThrow();
	});

	it('rejects data tables that are too large for the conversation UI', () => {
		expect(() =>
			validateHotelUi({
				root: 'root',
				state: {},
				elements: {
					root: {
						type: 'Table',
						props: {
							columns: ['日期', '收入'],
							rows: Array.from({ length: 76 }, (_, index) => [index, index * 100])
						},
						children: [],
						visible: true
					}
				}
			})
		).toThrow('cannot exceed 75 rows');
	});

	it('rejects nested table cells before the renderer can coerce them to object text', () => {
		expect(() =>
			validateHotelUi({
				root: 'root',
				state: {},
				elements: {
					root: {
						type: 'Table',
						props: {
							columns: ['日期', '天气'],
							rows: [['2026-08-13', { temperature: 31 }]]
						},
						children: [],
						visible: true
					}
				}
			})
		).toThrow('scalar cells');
	});
});
