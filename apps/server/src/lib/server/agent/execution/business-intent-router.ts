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
	classify(input: Readonly<{ text: string }>): Promise<RouteClassifierOutput>;
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

export class BusinessIntentRouter {
	constructor(private readonly classifier: RouteClassifier) {}

	async route(
		input:
			| Readonly<{ kind: 'quick_action'; quickActionId: AgentQuickActionId }>
			| Readonly<{ kind: 'prompt'; text: string }>
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

		const proposed = routeClassifierOutputSchema.parse(
			await this.classifier.classify({ text: input.text })
		);
		if (proposed.requestedEffect === 'write' || directWriteRequest.test(input.text)) {
			return {
				routeKind: 'business_write',
				intent: null,
				slots: {},
				confidence: 1,
				responseMode: 'analysis'
			};
		}
		if (proposed.category === 'business_read') {
			const intent = proposed.intentCandidate ?? 'generic_hotel_data_query';
			return {
				routeKind: 'business_read',
				intent,
				slots: registeredCandidateSlots(intent, proposed.slots),
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
