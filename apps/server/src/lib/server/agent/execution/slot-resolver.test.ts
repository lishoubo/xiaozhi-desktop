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
				dateRange: { status: 'candidate', raw: '2026-07-01/2026-07-31' }
			},
			anchorMessageId: '22222222-2222-4222-8222-222222222222',
			version: 1
		});

		expect(result.status).toBe('ready');
		expect(hotels.resolve).not.toHaveBeenCalled();
	});

	it('keeps a submitted managed-hotel choice and rejects partially matched multi-hotel input', async () => {
		const resolver = new BusinessSlotResolver(
			{ resolve: vi.fn().mockResolvedValue([]) },
			() => now
		);
		const hotelAccess = {
			kind: 'staff_managed_hotels' as const,
			currentHotelId: '9',
			hotels: [
				{ id: '9', label: '银际酒店' },
				{ id: '10', label: '青山酒店' }
			]
		};
		const base = {
			definition: getIntentDefinition('generic_hotel_data_query'),
			intent: 'generic_hotel_data_query' as const,
			responseMode: 'data_only' as const,
			orgId: '42',
			hotelAccess,
			anchorMessageId: '22222222-2222-4222-8222-222222222222',
			version: 2
		};

		await expect(
			resolver.resolve({
				...base,
				slots: {
					hotelReference: {
						status: 'resolved',
						value: '9',
						source: { kind: 'user_selected_candidate' }
					}
				}
			})
		).resolves.toMatchObject({ status: 'ready', request: { slots: { hotelReference: '9' } } });
		await expect(
			resolver.resolve({
				...base,
				slots: { hotelReference: { status: 'candidate', raw: '银际酒店、未知酒店' } }
			})
		).resolves.toMatchObject({
			status: 'needs_clarification',
			slots: { hotelReference: { status: 'invalid', reasonCode: 'hotel_not_managed' } }
		});
		await expect(
			resolver.resolve({
				...base,
				hotelAccess: {
					...hotelAccess,
					hotels: [{ id: '10', label: '青山酒店' }]
				},
				slots: {
					hotelReference: {
						status: 'resolved',
						value: '9',
						source: { kind: 'user_selected_candidate' }
					}
				}
			})
		).resolves.toMatchObject({
			status: 'needs_clarification',
			slots: { hotelReference: { status: 'invalid', reasonCode: 'hotel_not_managed' } }
		});
	});

	it('uses DMS aliases only when they resolve to a hotel already in the staff access scope', async () => {
		const hotels = {
			resolve: vi.fn().mockResolvedValue([
				{
					id: '4',
					label: '银际酒店(包头青山王府井文化路店)',
					match: 'exact',
					accessScope: 'shared_dms_token'
				},
				{
					id: '99',
					label: '同名未授权酒店',
					match: 'alias',
					accessScope: 'shared_dms_token'
				}
			])
		};
		const resolver = new BusinessSlotResolver(hotels, () => now);

		await expect(
			resolver.resolve({
				definition: getIntentDefinition('hotel_operating_summary'),
				intent: 'hotel_operating_summary',
				orgId: '42',
				hotelAccess: {
					kind: 'staff_managed_hotels',
					currentHotelId: '4',
					hotels: [{ id: '4', label: '银际酒店（包头青山文化路王府井店）' }]
				},
				slots: {
					hotelReference: {
						status: 'candidate',
						raw: '银际酒店(包头青山王府井文化路店)'
					},
					dateRange: { status: 'candidate', raw: '2026-08-01/2026-08-13' }
				},
				anchorMessageId: '22222222-2222-4222-8222-222222222222',
				version: 1
			})
		).resolves.toMatchObject({
			status: 'ready',
			request: { slots: { hotelReference: '4' } }
		});
		expect(hotels.resolve).toHaveBeenCalledOnce();
	});

	it('asks only for the hotel when a generic latest-data lookup already has its default date', async () => {
		const hotels = { resolve: vi.fn() };
		const resolver = new BusinessSlotResolver(hotels, () => now);

		await expect(
			resolver.resolve({
				definition: getIntentDefinition('generic_hotel_data_query'),
				intent: 'generic_hotel_data_query',
				responseMode: 'data_only',
				orgId: '42',
				slots: { dateRange: { status: 'candidate', raw: '2026-07-15/2026-08-13' } },
				anchorMessageId: '22222222-2222-4222-8222-222222222222',
				version: 1
			})
		).resolves.toMatchObject({
			status: 'needs_clarification',
			clarification: {
				prompt: '请选择酒店。',
				fields: [{ slot: 'hotelReference', label: '酒店' }]
			},
			slots: {
				dateRange: {
					status: 'resolved',
					value: { start: '2026-07-15', end: '2026-08-13' }
				},
				resultLimit: { status: 'resolved', value: 50 }
			}
		});
		expect(hotels.resolve).not.toHaveBeenCalled();
	});

	it('uses one managed hotel by default and offers all managed hotels when several are available', async () => {
		const hotels = { resolve: vi.fn() };
		const resolver = new BusinessSlotResolver(hotels, () => now);
		const base = {
			definition: getIntentDefinition('generic_hotel_data_query'),
			intent: 'generic_hotel_data_query' as const,
			responseMode: 'data_only' as const,
			orgId: '42',
			slots: {},
			anchorMessageId: '22222222-2222-4222-8222-222222222222',
			version: 1
		};

		await expect(
			resolver.resolve({
				...base,
				hotelAccess: {
					kind: 'staff_managed_hotels',
					currentHotelId: '9',
					hotels: [{ id: '9', label: '银际酒店' }]
				}
			})
		).resolves.toMatchObject({
			status: 'ready',
			request: { slots: { hotelReference: '9' } }
		});
		await expect(
			resolver.resolve({
				...base,
				hotelAccess: {
					kind: 'staff_managed_hotels',
					currentHotelId: '9',
					hotels: [
						{ id: '9', label: '银际酒店' },
						{ id: '10', label: '青山酒店' }
					]
				}
			})
		).resolves.toMatchObject({
			status: 'needs_clarification',
			clarification: {
				fields: [
					{
						kind: 'single_choice',
						choices: [
							{ value: '9', label: '银际酒店' },
							{ value: '10', label: '青山酒店' }
						]
					}
				]
			}
		});
		expect(hotels.resolve).not.toHaveBeenCalled();
	});

	it('guides staff with no managed hotels and supports an explicit all-hotels scope', async () => {
		const resolver = new BusinessSlotResolver({ resolve: vi.fn() }, () => now);
		const base = {
			definition: getIntentDefinition('generic_hotel_data_query'),
			intent: 'generic_hotel_data_query' as const,
			responseMode: 'data_only' as const,
			orgId: '42',
			anchorMessageId: '22222222-2222-4222-8222-222222222222',
			version: 1
		};

		await expect(
			resolver.resolve({
				...base,
				slots: {},
				hotelAccess: {
					kind: 'staff_managed_hotels',
					currentHotelId: null,
					hotels: []
				}
			})
		).resolves.toMatchObject({
			status: 'needs_clarification',
			clarification: {
				prompt: expect.stringContaining('酒店管理'),
				action: {
					kind: 'navigate',
					destination: 'hotel_management',
					label: '前往酒店管理'
				}
			}
		});
		await expect(
			resolver.resolve({
				...base,
				slots: { hotelReference: { status: 'candidate', raw: '*' } },
				hotelAccess: {
					kind: 'staff_managed_hotels',
					currentHotelId: '9',
					hotels: [
						{ id: '9', label: '银际酒店' },
						{ id: '10', label: '青山酒店' }
					]
				}
			})
		).resolves.toMatchObject({
			status: 'ready',
			request: { slots: { hotelReference: ['9', '10'] } }
		});
		await expect(
			resolver.resolve({
				...base,
				slots: { hotelReference: { status: 'candidate', raw: '银际酒店、青山酒店' } },
				hotelAccess: {
					kind: 'staff_managed_hotels',
					currentHotelId: '9',
					hotels: [
						{ id: '9', label: '银际酒店' },
						{ id: '10', label: '青山酒店' }
					]
				}
			})
		).resolves.toMatchObject({
			status: 'ready',
			request: { slots: { hotelReference: ['9', '10'] } }
		});
	});

	it('normalizes relative dates with the explicit application timezone', () => {
		expect(resolveRelativeDateRange('@date:yesterday', now)).toEqual({
			start: '2026-08-12',
			end: '2026-08-12',
			timezone: 'Asia/Shanghai',
			original: '@date:yesterday'
		});
		expect(resolveRelativeDateRange('@date:complete-days:7', now)).toMatchObject({
			start: '2026-08-06',
			end: '2026-08-12'
		});
		expect(resolveRelativeDateRange('2026-08-10/2026-08-12', now)).toMatchObject({
			start: '2026-08-10',
			end: '2026-08-12'
		});
		expect(resolveRelativeDateRange('@date:month-to-date', now)).toMatchObject({
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
				checkIn: { status: 'candidate', raw: '2026-08-14' },
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
				dateRange: { status: 'candidate', raw: '@date:yesterday' }
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

	it('asks for an explicitly constrained optional date when it cannot be normalized', async () => {
		const resolver = new BusinessSlotResolver(
			{
				resolve: vi.fn().mockResolvedValue([
					{
						id: '4',
						label: '银际酒店',
						match: 'exact',
						accessScope: 'shared_dms_token'
					}
				])
			},
			() => now
		);

		const result = await resolver.resolve({
			definition: getIntentDefinition('generic_hotel_data_query'),
			intent: 'generic_hotel_data_query',
			orgId: '42',
			slots: {
				hotelReference: { status: 'candidate', raw: '银际酒店' },
				dateRange: { status: 'candidate', raw: '@date:needs-clarification' },
				metrics: { status: 'candidate', raw: '流量' }
			},
			anchorMessageId: '22222222-2222-4222-8222-222222222222',
			version: 1
		});

		expect(result).toMatchObject({
			status: 'needs_clarification',
			slots: { metrics: { status: 'resolved', value: '流量' } },
			clarification: {
				fields: [{ slot: 'dateRange', kind: 'date_range', required: true }]
			}
		});
	});

	it('normalizes typed scalar candidates instead of dropping them from the request', async () => {
		const resolver = new BusinessSlotResolver({ resolve: vi.fn() }, () => now);

		await expect(
			resolver.resolve({
				definition: getIntentDefinition('generic_hotel_data_query'),
				intent: 'generic_hotel_data_query',
				orgId: '42',
				hotelAccess: {
					kind: 'staff_managed_hotels',
					currentHotelId: '4',
					hotels: [{ id: '4', label: '银际酒店' }]
				},
				slots: {
					metrics: { status: 'candidate', raw: '流量漏斗' },
					resultLimit: { status: 'candidate', raw: '25' }
				},
				anchorMessageId: '22222222-2222-4222-8222-222222222222',
				version: 1
			})
		).resolves.toMatchObject({
			status: 'ready',
			request: {
				slots: { hotelReference: '4', metrics: '流量漏斗', resultLimit: 25 }
			}
		});

		await expect(
			resolver.resolve({
				definition: getIntentDefinition('public_hotel_rates'),
				intent: 'public_hotel_rates',
				orgId: '42',
				slots: {
					hotelReference: { status: 'resolved', value: '4', source: { kind: 'user_text' } },
					checkIn: { status: 'candidate', raw: '2026-08-14' },
					checkOut: { status: 'candidate', raw: '2026-08-16' },
					guests: { status: 'candidate', raw: '3' },
					currency: { status: 'candidate', raw: 'usd' }
				},
				anchorMessageId: '22222222-2222-4222-8222-222222222222',
				version: 1
			})
		).resolves.toMatchObject({
			status: 'ready',
			request: { slots: { guests: 3, currency: 'USD' } }
		});
	});

	it('clarifies invalid typed scalar candidates before execution', async () => {
		const resolver = new BusinessSlotResolver({ resolve: vi.fn() }, () => now);

		await expect(
			resolver.resolve({
				definition: getIntentDefinition('generic_hotel_data_query'),
				intent: 'generic_hotel_data_query',
				orgId: '42',
				hotelAccess: {
					kind: 'staff_managed_hotels',
					currentHotelId: '4',
					hotels: [{ id: '4', label: '银际酒店' }]
				},
				slots: { resultLimit: { status: 'candidate', raw: '0' } },
				anchorMessageId: '22222222-2222-4222-8222-222222222222',
				version: 1
			})
		).resolves.toMatchObject({
			status: 'needs_clarification',
			slots: { resultLimit: { status: 'invalid', reasonCode: 'result_limit_invalid' } },
			clarification: { fields: [{ slot: 'resultLimit', required: true }] }
		});
	});
});
