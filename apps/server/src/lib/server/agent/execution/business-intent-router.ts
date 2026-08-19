import {
	agentBusinessIntentSchema,
	agentBusinessRouteKindSchema,
	type AgentBusinessIntent,
	type AgentBusinessRouteKind,
	type AgentQuickActionId
} from '@hotel-butler/api';
import { z } from 'zod';
import type { SlotCollection } from './business-execution-state';
import { getIntentDefinition, quickActionIntent } from './intent-registry';

export const routeClassifierOutputSchema = z.strictObject({
	category: agentBusinessRouteKindSchema,
	intentCandidate: agentBusinessIntentSchema.nullable(),
	requestedEffect: z.enum(['explain', 'read', 'write', 'unclear']),
	responseMode: z.enum(['analysis', 'data_only']),
	confidence: z.number().min(0).max(1),
	slots: z.record(z.string().min(1).max(80), z.string().min(1).max(2_000))
});
export type RouteClassifierOutput = Readonly<z.infer<typeof routeClassifierOutputSchema>>;

export interface RouteClassifier {
	classify(input: Readonly<{ text: string; context?: string }>): Promise<RouteClassifierOutput>;
}

export type RouteDecision = Readonly<{
	routeKind: AgentBusinessRouteKind;
	intent: AgentBusinessIntent | null;
	slots: SlotCollection;
	confidence: number;
	responseMode: 'analysis' | 'data_only';
}>;

const directWriteRequest =
	/(?:帮我|请|立即|直接|现在|把).{0,24}(?:改价|调价|提高|降低|修改|更新|删除|取消订单|退款|支付|发布|关房|开房|停售|上架|下架)/i;
const analysisRequest =
	/(?:分析|概览|趋势|原因|为什么|为何|异常|建议|对比|比较|变化|复盘|解读|预测|洞察|相关性|表现如何)/i;
const directDataLookup =
	/(?:查询|查一下|查找|看一下|看看|列出|显示|获取|返回|最新|明细|详情|有多少|多少条)/i;
const currentDataLookup = /(?:当前|今天|今日|现在|实时)/i;
const recentDataLookup = /(?:最新|最近|近期|近来)/i;
const explicitDateLookup =
	/(?:最近7天|近7天|过去7天|本月至今|上个月|昨天|今天|今日|\d{4}-\d{2}-\d{2})/i;
const allHotelsLookup = /(?:(?:所有|全部|全量|各个|各家|每家)酒店|酒店(?:全部|全量))/i;
const weatherLookup = /(?:天气|气温|温度|下雨|降雨|暴雨|台风|下雪|降雪|晴天|阴天)/i;
const hotelOperationsContext =
	/(?:经营|运营|入住|出租率|房价|收益|营收|订单|预订|房态|库存|渠道|排班|客流|营销|RevPAR|ADR|GMV)/i;
const hotelFactMetric =
	/(?:经营数据|经营概览|入住率|出租率|房价|收益|营收|订单|预订|房态|库存|渠道数据|RevPAR|ADR|GMV)/i;
const ownedHotelReference = /(?:我们|我方|本酒店|当前酒店|这家酒店|我的酒店)/i;
const simpleGreeting =
	/^(?:你?好|您好|嗨|哈[喽啰罗]|hello|hi|早上好|上午好|下午好|晚上好|在吗|谢谢|感谢|再见)[!！?？,.，。~～\s]*$/i;
const internalLookupDeclined =
	/(?:不要|不用|无需|别).{0,10}(?:查询|查找|读取|调用).{0,10}(?:系统|内部|酒店|经营)?(?:信息|数据)?|(?:不查询|不查|不读取)(?:系统|内部|酒店|经营)?(?:信息|数据)?/i;

function explicitlyRequestsHotelFacts(text: string): boolean {
	return (
		hotelFactMetric.test(text) &&
		(directDataLookup.test(text) ||
			(ownedHotelReference.test(text) &&
				(currentDataLookup.test(text) || recentDataLookup.test(text) || explicitDateLookup.test(text))))
	);
}

function responseModeForPrompt(
	text: string,
	proposed: RouteClassifierOutput['responseMode']
): RouteClassifierOutput['responseMode'] {
	if (proposed === 'data_only') return proposed;
	return directDataLookup.test(text) && !analysisRequest.test(text) ? 'data_only' : proposed;
}

function candidateSlots(values: Readonly<Record<string, string>>): SlotCollection {
	return Object.fromEntries(
		Object.entries(values).map(([name, raw]) => [name, { status: 'candidate' as const, raw }])
	);
}

function registeredCandidateSlots(
	intent: AgentBusinessIntent,
	values: Readonly<Record<string, string>>
): SlotCollection {
	const allowed = new Set(getIntentDefinition(intent).slots.map((slot) => slot.name));
	return candidateSlots(
		Object.fromEntries(Object.entries(values).filter(([name]) => allowed.has(name)))
	);
}

function defaultTemporalSlots(
	intent: AgentBusinessIntent,
	text: string,
	slots: SlotCollection
): SlotCollection {
	if (intent !== 'generic_hotel_data_query' || slots.dateRange) return slots;
	const explicit = text.match(explicitDateLookup)?.[0] ?? null;
	const raw = explicit
		? /^(?:近7天|过去7天)$/.test(explicit)
			? '最近7天'
			: explicit === '今日'
				? '今天'
				: explicit
		: currentDataLookup.test(text)
			? '今天'
			: recentDataLookup.test(text)
				? '最近30天（含今天）'
				: null;
	return raw ? { ...slots, dateRange: { status: 'candidate', raw } } : slots;
}

function explicitHotelScopeSlots(
	intent: AgentBusinessIntent,
	text: string,
	slots: SlotCollection
): SlotCollection {
	if (
		slots.hotelReference ||
		!getIntentDefinition(intent).slots.some(({ name }) => name === 'hotelReference')
	) {
		return slots;
	}
	const matched = text.match(allHotelsLookup)?.[0];
	return matched ? { ...slots, hotelReference: { status: 'candidate', raw: matched } } : slots;
}

export class BusinessIntentRouter {
	constructor(private readonly classifier: RouteClassifier) {}

	async route(
		input:
			| Readonly<{ kind: 'quick_action'; quickActionId: AgentQuickActionId }>
			| Readonly<{ kind: 'prompt'; text: string; context?: string }>
	): Promise<RouteDecision> {
		if (input.kind === 'quick_action') {
			const dateRange =
				input.quickActionId === 'yesterday_operating_review'
					? '昨天'
					: input.quickActionId === 'last_7_days_operating_trend' ||
						  input.quickActionId === 'channel_operating_comparison'
						? '最近7天'
						: input.quickActionId === 'month_to_date_operating_progress'
							? '本月至今'
							: null;
			return {
				routeKind: 'business_read',
				intent: quickActionIntent[input.quickActionId],
				slots: {
					...(dateRange ? { dateRange: { status: 'candidate' as const, raw: dateRange } } : {}),
					...(input.quickActionId === 'last_7_days_operating_trend'
						? {
								metrics: {
									status: 'resolved' as const,
									value: '按日经营趋势',
									source: { kind: 'quick_action' as const }
								}
							}
						: {}),
					...(input.quickActionId === 'channel_operating_comparison'
						? {
								metrics: {
									status: 'resolved' as const,
									value: '按渠道比较经营指标',
									source: { kind: 'quick_action' as const }
								}
							}
						: {})
				},
				confidence: 1,
				responseMode: 'analysis'
			};
		}
		if (directWriteRequest.test(input.text)) {
			return {
				routeKind: 'business_write',
				intent: null,
				slots: {},
				confidence: 1,
				responseMode: 'analysis'
			};
		}
		if (simpleGreeting.test(input.text)) {
			return {
				routeKind: 'general_conversation',
				intent: null,
				slots: {},
				confidence: 1,
				responseMode: 'analysis'
			};
		}
		if (weatherLookup.test(input.text) && !explicitlyRequestsHotelFacts(input.text)) {
			return {
				routeKind: hotelOperationsContext.test(input.text)
					? 'hotel_knowledge'
					: 'general_conversation',
				intent: null,
				slots: {},
				confidence: 0.95,
				responseMode: 'analysis'
			};
		}

		const proposed = routeClassifierOutputSchema.parse(
			await this.classifier.classify({
				text: input.text,
				...(input.context ? { context: input.context } : {})
			})
		);
		if (proposed.requestedEffect === 'write') {
			return {
				routeKind: 'business_write',
				intent: null,
				slots: {},
				confidence: 1,
				responseMode: 'analysis'
			};
		}
		if (
			weatherLookup.test(input.text) &&
			explicitlyRequestsHotelFacts(input.text) &&
			proposed.category === 'business_read' &&
			proposed.intentCandidate === 'weather_operations_advice'
		) {
			const intent = 'generic_hotel_data_query';
			const slots = explicitHotelScopeSlots(
				intent,
				input.text,
				registeredCandidateSlots(intent, proposed.slots)
			);
			return {
				routeKind: 'business_read',
				intent,
				slots: defaultTemporalSlots(intent, input.text, slots),
				confidence: proposed.confidence,
				responseMode: responseModeForPrompt(input.text, proposed.responseMode)
			};
		}
		if (proposed.category === 'business_read' && internalLookupDeclined.test(input.text)) {
			return {
				routeKind: 'hotel_knowledge',
				intent: null,
				slots: {},
				confidence: Math.max(proposed.confidence, 0.95),
				responseMode: 'analysis'
			};
		}
		if (proposed.category === 'business_read') {
			const intent = proposed.intentCandidate ?? 'generic_hotel_data_query';
			const slots = explicitHotelScopeSlots(
				intent,
				input.text,
				registeredCandidateSlots(intent, proposed.slots)
			);
			return {
				routeKind: 'business_read',
				intent,
				slots: defaultTemporalSlots(intent, input.text, slots),
				confidence: proposed.confidence,
				responseMode: responseModeForPrompt(input.text, proposed.responseMode)
			};
		}
		return {
			routeKind: proposed.category,
			intent: null,
			slots: {},
			confidence: proposed.confidence,
			responseMode: 'analysis'
		};
	}
}
