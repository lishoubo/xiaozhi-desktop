import { describe, expect, it, vi } from 'vitest';
import { BusinessIntentRouter } from './business-intent-router';

describe('BusinessIntentRouter', () => {
	it('maps a server-owned quick action without invoking the classifier', async () => {
		const classifier = { classify: vi.fn() };
		const router = new BusinessIntentRouter(classifier);

		await expect(
			router.route({ kind: 'quick_action', quickActionId: 'hotel_operating_data' })
		).resolves.toEqual({
			routeKind: 'business_read',
			intent: 'hotel_operating_summary',
			slots: {},
			confidence: 1
		});
		expect(classifier.classify).not.toHaveBeenCalled();
	});

	it('pre-fills bounded dates and metrics for common operating shortcuts', async () => {
		const classifier = { classify: vi.fn() };
		const router = new BusinessIntentRouter(classifier);

		await expect(
			router.route({ kind: 'quick_action', quickActionId: 'last_7_days_operating_trend' })
		).resolves.toMatchObject({
			intent: 'hotel_operating_summary',
			slots: {
				dateRange: { status: 'candidate', raw: '最近7天' },
				metrics: { status: 'resolved', value: '按日经营趋势' }
			}
		});
		await expect(
			router.route({ kind: 'quick_action', quickActionId: 'month_to_date_operating_progress' })
		).resolves.toMatchObject({
			intent: 'hotel_operating_summary',
			slots: { dateRange: { status: 'candidate', raw: '本月至今' } }
		});
		await expect(
			router.route({ kind: 'quick_action', quickActionId: 'channel_operating_comparison' })
		).resolves.toMatchObject({
			intent: 'generic_hotel_data_query',
			slots: {
				dateRange: { status: 'candidate', raw: '最近7天' },
				metrics: { status: 'resolved', value: '按渠道比较经营指标' }
			}
		});
		expect(classifier.classify).not.toHaveBeenCalled();
	});

	it('seeds yesterday for the daily operating review shortcut', async () => {
		const classifier = { classify: vi.fn() };
		const router = new BusinessIntentRouter(classifier);

		await expect(
			router.route({ kind: 'quick_action', quickActionId: 'yesterday_operating_review' })
		).resolves.toEqual({
			routeKind: 'business_read',
			intent: 'hotel_operating_summary',
			slots: { dateRange: { status: 'candidate', raw: '昨天' } },
			confidence: 1
		});
		expect(classifier.classify).not.toHaveBeenCalled();
	});

	it('routes an unanticipated safe hotel-data read to the generic workflow', async () => {
		const router = new BusinessIntentRouter({
			classify: vi.fn().mockResolvedValue({
				category: 'business_read',
				intentCandidate: null,
				requestedEffect: 'read',
				confidence: 0.82,
				slots: {
					hotelReference: '西湖店',
					dateRange: '上个月',
					metrics: '会员和非会员平均入住时长'
				}
			})
		});

		await expect(
			router.route({ kind: 'prompt', text: '比较上月会员入住时长' })
		).resolves.toMatchObject({
			routeKind: 'business_read',
			intent: 'generic_hotel_data_query',
			slots: {
				hotelReference: { status: 'candidate', raw: '西湖店' },
				dateRange: { status: 'candidate', raw: '上个月' }
			}
		});
	});

	it('drops model-proposed slots that are not registered for the selected intent', async () => {
		const router = new BusinessIntentRouter({
			classify: vi.fn().mockResolvedValue({
				category: 'business_read',
				intentCandidate: 'hotel_operating_summary',
				requestedEffect: 'read',
				confidence: 0.88,
				slots: {
					hotelReference: '西湖店',
					dateRange: '上个月',
					ranking: 'GMV 最高',
					unexpectedModelField: '不可进入状态机'
				}
			})
		});

		await expect(router.route({ kind: 'prompt', text: '查询西湖店上月经营概览' })).resolves.toEqual(
			{
				routeKind: 'business_read',
				intent: 'hotel_operating_summary',
				slots: {
					hotelReference: { status: 'candidate', raw: '西湖店' },
					dateRange: { status: 'candidate', raw: '上个月' }
				},
				confidence: 0.88
			}
		);
	});

	it('denies an explicit business write even when the classifier proposes a read', async () => {
		const router = new BusinessIntentRouter({
			classify: vi.fn().mockResolvedValue({
				category: 'business_read',
				intentCandidate: 'generic_hotel_data_query',
				requestedEffect: 'read',
				confidence: 0.91,
				slots: {}
			})
		});

		await expect(router.route({ kind: 'prompt', text: '请把下周房价提高20%' })).resolves.toEqual({
			routeKind: 'business_write',
			intent: null,
			slots: {},
			confidence: 1
		});
	});

	it('keeps explanatory knowledge separate from execution requests', async () => {
		const router = new BusinessIntentRouter({
			classify: vi.fn().mockResolvedValue({
				category: 'hotel_knowledge',
				intentCandidate: null,
				requestedEffect: 'explain',
				confidence: 0.95,
				slots: {}
			})
		});

		await expect(
			router.route({ kind: 'prompt', text: '酒店一般怎么改价？' })
		).resolves.toMatchObject({
			routeKind: 'hotel_knowledge',
			intent: null
		});
	});
});
