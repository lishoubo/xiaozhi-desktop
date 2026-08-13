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
}>;

const directWriteRequest =
	/(?:帮我|请|立即|直接|现在|把).{0,24}(?:改价|调价|提高|降低|修改|更新|删除|取消订单|退款|支付|发布|关房|开房|停售|上架|下架)/i;

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
			return {
				routeKind: 'business_read',
				intent: quickActionIntent[input.quickActionId],
				slots:
					input.quickActionId === 'yesterday_operating_review'
						? { dateRange: { status: 'candidate', raw: '昨天' } }
						: {},
				confidence: 1
			};
		}

		const proposed = routeClassifierOutputSchema.parse(
			await this.classifier.classify({ text: input.text })
		);
		if (proposed.requestedEffect === 'write' || directWriteRequest.test(input.text)) {
			return { routeKind: 'business_write', intent: null, slots: {}, confidence: 1 };
		}
		if (proposed.category === 'business_read') {
			const intent = proposed.intentCandidate ?? 'generic_hotel_data_query';
			return {
				routeKind: 'business_read',
				intent,
				slots: registeredCandidateSlots(intent, proposed.slots),
				confidence: proposed.confidence
			};
		}
		return {
			routeKind: proposed.category,
			intent: null,
			slots: {},
			confidence: proposed.confidence
		};
	}
}
