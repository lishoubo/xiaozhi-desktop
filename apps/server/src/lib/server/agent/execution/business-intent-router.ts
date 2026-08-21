import {
	agentBusinessIntentSchema,
	agentBusinessRouteKindSchema,
	type AgentBusinessIntent,
	type AgentBusinessRouteKind,
	type AgentQuickActionId
} from '@hotel-butler/api';
import { z } from 'zod';
import {
	isGenericHotelDataDomainRequest,
	isLikelyHotelDataRequest
} from '../hotel-data-business-catalog';
import type { SlotCollection } from './business-execution-state';
import { getIntentDefinition, quickActionIntent } from './intent-registry';

export const routeClassifierOutputSchema = z.strictObject({
	category: agentBusinessRouteKindSchema,
	intentCandidate: agentBusinessIntentSchema.nullable(),
	requestedEffect: z.enum(['explain', 'read', 'write', 'unclear']),
	responseMode: z.enum(['analysis', 'data_only']),
	confidence: z.number().min(0).max(1),
	slots: z
		.record(z.string().min(1).max(80), z.string().min(1).max(2_000))
		.describe(
			'Only explicitly requested or context-inherited candidates. Re-check hotelReference, date/dateRange and metrics before returning.'
		)
});
export type RouteClassifierOutput = Readonly<z.infer<typeof routeClassifierOutputSchema>>;

export interface RouteClassifier {
	classify(
		input: Readonly<{ text: string; context?: string; review?: boolean }>
	): Promise<RouteClassifierOutput>;
}

export type RouteDecision = Readonly<{
	routeKind: AgentBusinessRouteKind;
	intent: AgentBusinessIntent | null;
	slots: SlotCollection;
	confidence: number;
	responseMode: 'analysis' | 'data_only';
}>;

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

function inferredHotelDataSlots(
	text: string,
	values: Readonly<Record<string, string>>
): Readonly<Record<string, string>> {
	return values.metrics ? values : { ...values, metrics: text };
}

function shouldResolveFromContext(proposal: RouteClassifierOutput): boolean {
	return proposal.category === 'unclear' || proposal.category === 'business_read';
}

function mergeContextualProposal(
	current: RouteClassifierOutput,
	contextual: RouteClassifierOutput
): RouteClassifierOutput {
	if (current.category === 'unclear') {
		return contextual.requestedEffect === 'write' ? current : contextual;
	}
	if (current.category !== 'business_read' || contextual.category !== 'business_read')
		return current;
	return {
		...current,
		intentCandidate: contextual.intentCandidate ?? current.intentCandidate,
		slots: contextual.slots
	};
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
					? '@date:yesterday'
					: input.quickActionId === 'last_7_days_operating_trend' ||
						  input.quickActionId === 'channel_operating_comparison'
						? '@date:complete-days:7'
						: input.quickActionId === 'month_to_date_operating_progress'
							? '@date:month-to-date'
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
									value: '@metrics:daily-trend',
									source: { kind: 'quick_action' as const }
								}
							}
						: {}),
					...(input.quickActionId === 'yesterday_operating_review' ||
					input.quickActionId === 'month_to_date_operating_progress' ||
					input.quickActionId === 'hotel_operating_data'
						? {
								metrics: {
									status: 'resolved' as const,
									value: '@metrics:operating-summary',
									source: { kind: 'quick_action' as const }
								}
							}
						: {}),
					...(input.quickActionId === 'channel_operating_comparison'
						? {
								metrics: {
									status: 'resolved' as const,
									value: '@metrics:channel-comparison',
									source: { kind: 'quick_action' as const }
								}
							}
						: {})
				},
				confidence: 1,
				responseMode: 'analysis'
			};
		}
		const currentProposal = routeClassifierOutputSchema.parse(
			await this.classifier.classify({ text: input.text, review: false })
		);
		const safeProposal =
			input.context && shouldResolveFromContext(currentProposal)
				? mergeContextualProposal(
						currentProposal,
						routeClassifierOutputSchema.parse(
							await this.classifier.classify({ text: input.text, context: input.context })
						)
					)
				: currentProposal.category === 'business_read' ||
					  currentProposal.requestedEffect === 'write'
					? routeClassifierOutputSchema.parse(await this.classifier.classify({ text: input.text }))
					: currentProposal;
		if (safeProposal.requestedEffect === 'write') {
			return {
				routeKind: 'business_write',
				intent: null,
				slots: {},
				confidence: 1,
				responseMode: 'analysis'
			};
		}
		const likelyHotelDataRequest = isLikelyHotelDataRequest(input.text);
		if (safeProposal.category === 'business_read' || likelyHotelDataRequest) {
			const intent = isGenericHotelDataDomainRequest(input.text)
				? 'generic_hotel_data_query'
				: (safeProposal.intentCandidate ?? 'generic_hotel_data_query');
			const proposedSlots =
				intent === 'generic_hotel_data_query' && !safeProposal.slots.metrics
					? { ...safeProposal.slots, metrics: input.text }
					: safeProposal.slots;
			return {
				routeKind: 'business_read',
				intent,
				slots: registeredCandidateSlots(
					intent,
					likelyHotelDataRequest ? inferredHotelDataSlots(input.text, proposedSlots) : proposedSlots
				),
				confidence: safeProposal.confidence,
				responseMode: safeProposal.responseMode
			};
		}
		return {
			routeKind: safeProposal.category,
			intent: null,
			slots: {},
			confidence: safeProposal.confidence,
			responseMode: 'analysis'
		};
	}
}
