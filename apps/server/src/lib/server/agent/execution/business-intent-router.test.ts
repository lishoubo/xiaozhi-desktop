import { describe, expect, it, vi } from 'vitest';
import { BusinessIntentRouter } from './business-intent-router';
import { executionPolicyForIntent } from './intent-registry';
import { BusinessSlotResolver } from './slot-resolver';

describe('business route MCP dependencies', () => {
	it('derives the MCP allowlist from the registered business route', () => {
		expect(executionPolicyForIntent('hotel_operating_summary')).toEqual({
			allowedMcpCapabilities: ['hotel_data'],
			allowedSkillNames: [],
			allowedLocalToolNames: ['render_hotel_ui']
		});
		expect(executionPolicyForIntent('public_hotel_rates')).toEqual({
			allowedMcpCapabilities: ['hotel_rates'],
			allowedSkillNames: [],
			allowedLocalToolNames: ['render_hotel_ui']
		});
		expect(executionPolicyForIntent('weather_operations_advice')).toEqual({
			allowedMcpCapabilities: [],
			allowedSkillNames: [],
			allowedLocalToolNames: ['render_hotel_ui']
		});
	});
});
import { getIntentDefinition } from './intent-registry';

describe('BusinessIntentRouter', () => {
	it('routes a simple greeting from the model classifier', async () => {
		const classifier = {
			classify: vi.fn().mockResolvedValue({
				category: 'general_conversation',
				intentCandidate: null,
				requestedEffect: 'explain',
				responseMode: 'analysis',
				confidence: 1,
				slots: {}
			})
		};
		const router = new BusinessIntentRouter(classifier);

		await expect(router.route({ kind: 'prompt', text: '你好' })).resolves.toEqual({
			routeKind: 'general_conversation',
			intent: null,
			slots: {},
			confidence: 1,
			responseMode: 'analysis'
		});
		expect(classifier.classify).toHaveBeenCalledOnce();
		expect(classifier.classify).toHaveBeenCalledWith({ text: '你好', review: false });
	});

	it('maps a server-owned quick action without invoking the classifier', async () => {
		const classifier = { classify: vi.fn() };
		const router = new BusinessIntentRouter(classifier);

		await expect(
			router.route({ kind: 'quick_action', quickActionId: 'hotel_operating_data' })
		).resolves.toEqual({
			routeKind: 'business_read',
			intent: 'hotel_operating_summary',
			slots: {
				metrics: {
					status: 'resolved',
					value: '@metrics:operating-summary',
					source: { kind: 'quick_action' }
				}
			},
			confidence: 1,
			responseMode: 'analysis'
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
				dateRange: { status: 'candidate', raw: '@date:complete-days:7' },
				metrics: { status: 'resolved', value: '@metrics:daily-trend' }
			}
		});
		await expect(
			router.route({ kind: 'quick_action', quickActionId: 'month_to_date_operating_progress' })
		).resolves.toMatchObject({
			intent: 'hotel_operating_summary',
			slots: { dateRange: { status: 'candidate', raw: '@date:month-to-date' } }
		});
		await expect(
			router.route({ kind: 'quick_action', quickActionId: 'channel_operating_comparison' })
		).resolves.toMatchObject({
			intent: 'generic_hotel_data_query',
			slots: {
				dateRange: { status: 'candidate', raw: '@date:complete-days:7' },
				metrics: { status: 'resolved', value: '@metrics:channel-comparison' }
			}
		});
		expect(classifier.classify).not.toHaveBeenCalled();
		expect(getIntentDefinition('generic_hotel_data_query').maxToolCalls).toBe(8);
	});

	it('seeds yesterday for the daily operating review shortcut', async () => {
		const classifier = { classify: vi.fn() };
		const router = new BusinessIntentRouter(classifier);

		await expect(
			router.route({ kind: 'quick_action', quickActionId: 'yesterday_operating_review' })
		).resolves.toEqual({
			routeKind: 'business_read',
			intent: 'hotel_operating_summary',
			slots: {
				dateRange: { status: 'candidate', raw: '@date:yesterday' },
				metrics: {
					status: 'resolved',
					value: '@metrics:operating-summary',
					source: { kind: 'quick_action' }
				}
			},
			confidence: 1,
			responseMode: 'analysis'
		});
		expect(classifier.classify).not.toHaveBeenCalled();
	});

	it('routes an unanticipated safe hotel-data read to the generic workflow', async () => {
		const router = new BusinessIntentRouter({
			classify: vi.fn().mockResolvedValue({
				category: 'business_read',
				intentCandidate: null,
				requestedEffect: 'read',
				responseMode: 'data_only',
				confidence: 0.82,
				slots: {
					hotelReference: '西湖店',
					dateRange: '2026-07-01/2026-07-31',
					metrics: '会员和非会员平均入住时长'
				}
			})
		});

		await expect(
			router.route({ kind: 'prompt', text: '比较上月会员入住时长' })
		).resolves.toMatchObject({
			routeKind: 'business_read',
			intent: 'generic_hotel_data_query',
			responseMode: 'data_only',
			slots: {
				hotelReference: { status: 'candidate', raw: '西湖店' },
				dateRange: { status: 'candidate', raw: '2026-07-01/2026-07-31' }
			}
		});
	});

	it('uses the current request as the generic metric constraint when the model omits metrics', async () => {
		const router = new BusinessIntentRouter({
			classify: vi.fn().mockResolvedValue({
				category: 'business_read',
				intentCandidate: 'generic_hotel_data_query',
				requestedEffect: 'read',
				responseMode: 'analysis',
				confidence: 0.9,
				slots: { hotelReference: '银际酒店' }
			})
		});

		await expect(
			router.route({ kind: 'prompt', text: '分析这家店的客群和会员情况' })
		).resolves.toMatchObject({
			intent: 'generic_hotel_data_query',
			slots: { metrics: { status: 'candidate', raw: '分析这家店的客群和会员情况' } }
		});
	});

	it('uses the schema-informed backstop when the model misclassifies a traffic request', async () => {
		const router = new BusinessIntentRouter({
			classify: vi.fn().mockResolvedValue({
				category: 'hotel_knowledge',
				intentCandidate: null,
				requestedEffect: 'explain',
				responseMode: 'analysis',
				confidence: 0.7,
				slots: {
					hotelReference: '银际酒店',
					dateRange: '2026-08-13/2026-08-13',
					metrics: '流量'
				}
			})
		});

		await expect(
			router.route({ kind: 'prompt', text: '分析下这个酒店今日的流量情况' })
		).resolves.toMatchObject({
			routeKind: 'business_read',
			intent: 'generic_hotel_data_query',
			responseMode: 'analysis',
			slots: {
				hotelReference: { status: 'candidate', raw: '银际酒店' },
				dateRange: { status: 'candidate', raw: '2026-08-13/2026-08-13' },
				metrics: { status: 'candidate', raw: '流量' }
			}
		});
	});

	it('uses the model-classified response mode and normalized date range', async () => {
		const router = new BusinessIntentRouter({
			classify: vi.fn().mockResolvedValue({
				category: 'business_read',
				intentCandidate: 'generic_hotel_data_query',
				requestedEffect: 'read',
				responseMode: 'data_only',
				confidence: 0.9,
				slots: { dateRange: '2026-07-15/2026-08-13' }
			})
		});

		await expect(
			router.route({ kind: 'prompt', text: '查询最新的携程订单' })
		).resolves.toMatchObject({
			intent: 'generic_hotel_data_query',
			responseMode: 'data_only',
			slots: {
				dateRange: { status: 'candidate', raw: '2026-07-15/2026-08-13' }
			}
		});
	});

	it('preserves the model all-hotels protocol scope', async () => {
		const router = new BusinessIntentRouter({
			classify: vi.fn().mockResolvedValue({
				category: 'business_read',
				intentCandidate: 'generic_hotel_data_query',
				requestedEffect: 'read',
				responseMode: 'data_only',
				confidence: 0.9,
				slots: { hotelReference: '*' }
			})
		});

		await expect(
			router.route({ kind: 'prompt', text: '查询所有酒店的最新订单' })
		).resolves.toMatchObject({
			slots: { hotelReference: { status: 'candidate', raw: '*' } }
		});
	});

	it('derives today for current-state lookups without overriding an explicit date', async () => {
		const currentState = {
			category: 'business_read' as const,
			intentCandidate: 'generic_hotel_data_query' as const,
			requestedEffect: 'read' as const,
			responseMode: 'data_only' as const,
			confidence: 0.9,
			slots: { dateRange: '2026-08-13/2026-08-13' }
		};
		const explicitMonth = {
			...currentState,
			slots: { dateRange: '2026-07-01/2026-07-31' }
		};
		const classify = vi
			.fn()
			.mockResolvedValueOnce(currentState)
			.mockResolvedValueOnce(currentState)
			.mockResolvedValueOnce(explicitMonth)
			.mockResolvedValueOnce(explicitMonth);
		const router = new BusinessIntentRouter({ classify });

		await expect(router.route({ kind: 'prompt', text: '查看当前房态' })).resolves.toMatchObject({
			slots: { dateRange: { status: 'candidate', raw: '2026-08-13/2026-08-13' } }
		});
		await expect(
			router.route({ kind: 'prompt', text: '查询上个月的最新订单' })
		).resolves.toMatchObject({
			slots: { dateRange: { status: 'candidate', raw: '2026-07-01/2026-07-31' } }
		});
	});

	it('extracts a dynamic recent-day range when the classifier omits it', async () => {
		const router = new BusinessIntentRouter({
			classify: vi.fn().mockResolvedValue({
				category: 'business_read',
				intentCandidate: 'hotel_operating_summary',
				requestedEffect: 'read',
				responseMode: 'analysis',
				confidence: 0.91,
				slots: { hotelReference: '银际酒店', dateRange: '2026-08-16/2026-08-18' }
			})
		});

		await expect(
			router.route({ kind: 'prompt', text: '这个酒店近 3 天的经营情况如何' })
		).resolves.toMatchObject({
			intent: 'hotel_operating_summary',
			slots: { dateRange: { status: 'candidate', raw: '2026-08-16/2026-08-18' } }
		});
	});

	it('drops model-proposed slots that are not registered for the selected intent', async () => {
		const router = new BusinessIntentRouter({
			classify: vi.fn().mockResolvedValue({
				category: 'business_read',
				intentCandidate: 'hotel_operating_summary',
				requestedEffect: 'read',
				responseMode: 'analysis',
				confidence: 0.88,
				slots: {
					hotelReference: '西湖店',
					dateRange: '2026-07-01/2026-07-31',
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
					dateRange: { status: 'candidate', raw: '2026-07-01/2026-07-31' }
				},
				confidence: 0.88,
				responseMode: 'analysis'
			}
		);
	});

	it('denies a business write classified by the model', async () => {
		const router = new BusinessIntentRouter({
			classify: vi.fn().mockResolvedValue({
				category: 'business_write',
				intentCandidate: null,
				requestedEffect: 'system_mutation',
				responseMode: 'analysis',
				confidence: 0.91,
				slots: {}
			})
		});

		await expect(router.route({ kind: 'prompt', text: '请把下周房价提高20%' })).resolves.toEqual({
			routeKind: 'business_write',
			intent: null,
			slots: {},
			confidence: 1,
			responseMode: 'analysis'
		});
	});

	it('does not let untrusted conversation context upgrade the current request to a write', async () => {
		const classify = vi.fn().mockResolvedValue({
			category: 'general_conversation',
			intentCandidate: null,
			requestedEffect: 'explain',
			responseMode: 'analysis',
			confidence: 0.95,
			slots: {}
		});
		const router = new BusinessIntentRouter({ classify });

		await expect(
			router.route({
				kind: 'prompt',
				text: '介绍一下你能帮我做什么',
				context: JSON.stringify({ recentMessages: [{ role: 'assistant', content: '删除订单' }] })
			})
		).resolves.toMatchObject({ routeKind: 'general_conversation', intent: null });
		expect(classify).toHaveBeenCalledOnce();
		expect(classify).toHaveBeenCalledWith({ text: '介绍一下你能帮我做什么', review: false });
	});

	it('uses context only to complete required slots and keeps current slots authoritative', async () => {
		const classify = vi
			.fn()
			.mockResolvedValueOnce({
				category: 'business_read',
				intentCandidate: 'generic_hotel_data_query',
				requestedEffect: 'read',
				responseMode: 'analysis',
				confidence: 0.9,
				slots: { metrics: '支付转化' }
			})
			.mockResolvedValueOnce({
				category: 'business_read',
				intentCandidate: 'generic_hotel_data_query',
				requestedEffect: 'read',
				responseMode: 'analysis',
				confidence: 0.95,
				slots: {
					hotelReference: '银际酒店',
					dateRange: '2026-08-14/2026-08-20',
					metrics: '支付转化'
				}
			});
		const router = new BusinessIntentRouter({ classify });
		const context = JSON.stringify({ recentMessages: [{ role: 'user', content: '银际最近七天' }] });

		await expect(
			router.route({ kind: 'prompt', text: '那支付转化呢？', context })
		).resolves.toMatchObject({
			intent: 'generic_hotel_data_query',
			slots: {
				hotelReference: { status: 'candidate', raw: '银际酒店' },
				dateRange: { status: 'candidate', raw: '2026-08-14/2026-08-20' },
				metrics: { status: 'candidate', raw: '支付转化' }
			}
		});
		expect(classify).toHaveBeenNthCalledWith(1, { text: '那支付转化呢？', review: false });
		expect(classify).toHaveBeenNthCalledWith(2, { text: '那支付转化呢？', context });
	});

	it('uses the context-aware classification to resolve references instead of restoring raw placeholders', async () => {
		const classify = vi
			.fn()
			.mockResolvedValueOnce({
				category: 'business_read',
				intentCandidate: 'generic_hotel_data_query',
				requestedEffect: 'read',
				responseMode: 'analysis',
				confidence: 0.9,
				slots: { hotelReference: '这家店', metrics: '渠道核销对比' }
			})
			.mockResolvedValueOnce({
				category: 'business_read',
				intentCandidate: 'generic_hotel_data_query',
				requestedEffect: 'read',
				responseMode: 'analysis',
				confidence: 0.95,
				slots: {
					hotelReference: '银际酒店（包头青山王府井文化路店）',
					dateRange: '2026-08-15/2026-08-21',
					metrics: '渠道核销对比'
				}
			});
		const router = new BusinessIntentRouter({ classify });

		await expect(
			router.route({
				kind: 'prompt',
				text: '看看这家店是不是哪个渠道拖后腿',
				context: '{"recentBusinessRequests":[]}'
			})
		).resolves.toMatchObject({
			slots: {
				hotelReference: {
					status: 'candidate',
					raw: '银际酒店（包头青山王府井文化路店）'
				},
				dateRange: { status: 'candidate', raw: '2026-08-15/2026-08-21' }
			}
		});
	});

	it('continues the latest structured business request without treating control text as a metric', async () => {
		const classify = vi
			.fn()
			.mockResolvedValueOnce({
				category: 'unclear',
				intentCandidate: null,
				requestedEffect: 'unclear',
				responseMode: 'analysis',
				confidence: 0.45,
				slots: {}
			})
			.mockResolvedValueOnce({
				category: 'business_read',
				intentCandidate: 'generic_hotel_data_query',
				requestedEffect: 'read',
				responseMode: 'analysis',
				confidence: 0.93,
				slots: {
					hotelReference: '4',
					dateRange: '2026-08-15/2026-08-21',
					metrics: '流量漏斗'
				}
			});
		const router = new BusinessIntentRouter({ classify });

		const decision = await router.route({
			kind: 'prompt',
			text: '继续执行',
			context: JSON.stringify({
				recentBusinessRequests: [
					{
						routeKind: 'business_read',
						intent: 'generic_hotel_data_query',
						slots: {
							hotelReference: '4',
							dateRange: '2026-08-15/2026-08-21',
							metrics: '流量漏斗'
						}
					}
				]
			})
		});
		expect(decision).toMatchObject({
			routeKind: 'business_read',
			intent: 'generic_hotel_data_query',
			slots: {
				hotelReference: { status: 'candidate', raw: '4' },
				dateRange: { status: 'candidate', raw: '2026-08-15/2026-08-21' },
				metrics: { status: 'candidate', raw: '流量漏斗' }
			}
		});

		const resolution = await new BusinessSlotResolver({ resolve: vi.fn() }).resolve({
			definition: getIntentDefinition('generic_hotel_data_query'),
			intent: 'generic_hotel_data_query',
			responseMode: decision.responseMode,
			orgId: '42',
			hotelAccess: {
				kind: 'staff_managed_hotels',
				currentHotelId: '4',
				hotels: [{ id: '4', label: '银际酒店' }]
			},
			slots: decision.slots,
			anchorMessageId: '22222222-2222-4222-8222-222222222222',
			version: 1
		});
		expect(resolution).toMatchObject({
			status: 'ready',
			request: {
				slots: {
					hotelReference: '4',
					dateRange: { start: '2026-08-15', end: '2026-08-21' },
					metrics: '流量漏斗'
				}
			}
		});
	});

	it('requests clarification when a context-dependent query has no recoverable business target', async () => {
		const classify = vi
			.fn()
			.mockResolvedValueOnce({
				category: 'unclear',
				intentCandidate: null,
				requestedEffect: 'unclear',
				responseMode: 'analysis',
				confidence: 0.4,
				slots: {}
			})
			.mockResolvedValueOnce({
				category: 'business_read',
				intentCandidate: 'generic_hotel_data_query',
				requestedEffect: 'read',
				responseMode: 'analysis',
				confidence: 0.7,
				slots: { hotelReference: '4' }
			});
		const router = new BusinessIntentRouter({ classify });

		await expect(
			router.route({ kind: 'prompt', text: 'continue', context: '{"recentMessages":[]}' })
		).resolves.toMatchObject({
			routeKind: 'business_read',
			intent: 'generic_hotel_data_query',
			slots: {
				hotelReference: { status: 'candidate', raw: '4' },
				metrics: { status: 'invalid', reasonCode: 'context_target_missing' }
			}
		});
	});

	it('keeps explanatory knowledge separate from execution requests', async () => {
		const router = new BusinessIntentRouter({
			classify: vi.fn().mockResolvedValue({
				category: 'hotel_knowledge',
				intentCandidate: null,
				requestedEffect: 'explain',
				responseMode: 'analysis',
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

	it('corrects standalone weather to general conversation without hotel slots', async () => {
		const classifier = {
			classify: vi.fn().mockResolvedValue({
				category: 'general_conversation',
				intentCandidate: null,
				requestedEffect: 'explain',
				responseMode: 'analysis',
				confidence: 0.95,
				slots: {}
			})
		};
		const router = new BusinessIntentRouter(classifier);

		await expect(router.route({ kind: 'prompt', text: '今天天气如何？' })).resolves.toEqual({
			routeKind: 'general_conversation',
			intent: null,
			slots: {},
			confidence: 0.95,
			responseMode: 'analysis'
		});
		expect(classifier.classify).toHaveBeenCalledOnce();
	});

	it('keeps weather-informed operating advice on the LLM-only hotel knowledge route', async () => {
		const classifier = {
			classify: vi.fn().mockResolvedValue({
				category: 'hotel_knowledge',
				intentCandidate: null,
				requestedEffect: 'explain',
				responseMode: 'analysis',
				confidence: 0.9,
				slots: {}
			})
		};
		const router = new BusinessIntentRouter(classifier);

		await expect(
			router.route({ kind: 'prompt', text: '结合杭州今天的天气给酒店经营和排班建议' })
		).resolves.toEqual({
			routeKind: 'hotel_knowledge',
			intent: null,
			slots: {},
			confidence: 0.9,
			responseMode: 'analysis'
		});
		expect(classifier.classify).toHaveBeenCalledOnce();
	});

	it('honors an explicit request not to query internal hotel data', async () => {
		const router = new BusinessIntentRouter({
			classify: vi.fn().mockResolvedValue({
				category: 'hotel_knowledge',
				intentCandidate: null,
				requestedEffect: 'explain',
				responseMode: 'analysis',
				confidence: 0.88,
				slots: {}
			})
		});

		await expect(
			router.route({ kind: 'prompt', text: '不要查询系统数据，只说说酒店提升入住率的一般方法' })
		).resolves.toMatchObject({ routeKind: 'hotel_knowledge', intent: null, slots: {} });
	});
});
