import { describe, expect, it, vi } from 'vitest';
import { getIntentDefinition } from './intent-registry';
import { BusinessSlotResolver, resolveRelativeDateRange } from './slot-resolver';

const now = new Date('2026-08-13T04:00:00.000Z');

describe('slot resolution', () => {
	it('accepts an explicit numeric hotel ID without a directory lookup', async () => {
		const hotels = { resolve: vi.fn() };
		const resolver = new BusinessSlotResolver(hotels, () => now);
		const result = await resolver.resolve({
			definition: getIntentDefinition('hotel_operating_summary'),
			intent: 'hotel_operating_summary',
			orgId: '42',
			slots: {
				hotelReference: { status: 'candidate', raw: '123' },
				dateRange: { status: 'candidate', raw: '上个月' }
			},
			anchorMessageId: '22222222-2222-4222-8222-222222222222',
			version: 1
		});

		expect(result.status).toBe('ready');
		expect(hotels.resolve).not.toHaveBeenCalled();
	});

	it('does not require operating-summary filters for a generic data lookup', async () => {
		const hotels = { resolve: vi.fn() };
		const resolver = new BusinessSlotResolver(hotels, () => now);

		await expect(
			resolver.resolve({
				definition: getIntentDefinition('generic_hotel_data_query'),
				intent: 'generic_hotel_data_query',
				responseMode: 'data_only',
				orgId: '42',
				slots: {},
				anchorMessageId: '22222222-2222-4222-8222-222222222222',
				version: 1
			})
		).resolves.toMatchObject({
			status: 'ready',
			request: {
				intent: 'generic_hotel_data_query',
				responseMode: 'data_only',
				slots: { resultLimit: 20 }
			}
		});
		expect(hotels.resolve).not.toHaveBeenCalled();
	});

	it('normalizes relative dates with the explicit application timezone', () => {
		expect(resolveRelativeDateRange('昨天', now)).toEqual({
			start: '2026-08-12',
			end: '2026-08-12',
			timezone: 'Asia/Shanghai',
			original: '昨天'
		});
		expect(resolveRelativeDateRange('上周', now)).toMatchObject({
			start: '2026-08-03',
			end: '2026-08-09',
			timezone: 'Asia/Shanghai'
		});
		expect(resolveRelativeDateRange('最近7天', now)).toMatchObject({
			start: '2026-08-06',
			end: '2026-08-12'
		});
		expect(resolveRelativeDateRange('本月至今', now)).toMatchObject({
			start: '2026-08-01',
			end: '2026-08-13'
		});
	});

	it('turns several hotel candidates and missing dates into deterministic fields', async () => {
		const hotels = {
			resolve: vi.fn().mockResolvedValue([
				{ id: 'hotel-1', label: '杭州西湖店', match: 'fuzzy', accessScope: 'shared_dms_token' },
				{ id: 'hotel-2', label: '西湖景区店', match: 'fuzzy', accessScope: 'shared_dms_token' }
			])
		};
		const resolver = new BusinessSlotResolver(hotels, () => now);

		const result = await resolver.resolve({
			definition: getIntentDefinition('public_hotel_rates'),
			intent: 'public_hotel_rates',
			orgId: '42',
			slots: { hotelReference: { status: 'candidate', raw: '西湖店' } },
			anchorMessageId: '22222222-2222-4222-8222-222222222222',
			version: 2
		});

		expect(result).toMatchObject({
			status: 'needs_clarification',
			slots: {
				hotelReference: { status: 'ambiguous' },
				guests: { status: 'resolved', value: 2 },
				currency: { status: 'resolved', value: 'CNY' }
			}
		});
		if (result.status === 'needs_clarification') {
			expect(result.clarification.fields.map((field) => field.kind)).toEqual([
				'single_choice',
				'date',
				'date'
			]);
		}
	});

	it('produces an immutable request after exact hotel and date resolution', async () => {
		const resolver = new BusinessSlotResolver(
			{
				resolve: vi
					.fn()
					.mockResolvedValue([
						{ id: 'hotel-1', label: '杭州西湖店', match: 'exact', accessScope: 'shared_dms_token' }
					])
			},
			() => now
		);

		const result = await resolver.resolve({
			definition: getIntentDefinition('public_hotel_rates'),
			intent: 'public_hotel_rates',
			orgId: '42',
			slots: {
				hotelReference: { status: 'candidate', raw: '杭州西湖店' },
				checkIn: { status: 'candidate', raw: '明天' },
				checkOut: { status: 'candidate', raw: '2026-08-16' }
			},
			anchorMessageId: '22222222-2222-4222-8222-222222222222',
			version: 2
		});

		expect(result).toMatchObject({
			status: 'ready',
			request: {
				intent: 'public_hotel_rates',
				slots: {
					hotelReference: 'hotel-1',
					checkIn: '2026-08-14',
					checkOut: '2026-08-16',
					guests: 2,
					currency: 'CNY'
				}
			}
		});
	});

	it('explains when the MCP hotel-name projection has no match', async () => {
		const resolver = new BusinessSlotResolver(
			{ resolve: vi.fn().mockResolvedValue([]) },
			() => now
		);

		const result = await resolver.resolve({
			definition: getIntentDefinition('hotel_operating_summary'),
			intent: 'hotel_operating_summary',
			orgId: '42',
			slots: {
				hotelReference: { status: 'candidate', raw: '未同步的酒店' },
				dateRange: { status: 'candidate', raw: '昨天' }
			},
			anchorMessageId: '22222222-2222-4222-8222-222222222222',
			version: 1
		});

		expect(result).toMatchObject({
			status: 'needs_clarification',
			clarification: {
				prompt: '未从酒店数据中匹配到该名称，请输入 OTA 后台显示的完整酒店名称。'
			}
		});
	});
});
