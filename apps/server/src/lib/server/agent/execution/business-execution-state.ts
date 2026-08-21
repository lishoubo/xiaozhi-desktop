import {
	agentBusinessIntentSchema,
	agentBusinessRouteKindSchema,
	agentPendingClarificationSchema,
	type AgentBusinessIntent,
	type AgentBusinessRouteKind,
	type AgentPendingClarification
} from '@hotel-butler/api';
import { z } from 'zod';

export type JsonValue =
	string | number | boolean | null | readonly JsonValue[] | Readonly<{ [key: string]: JsonValue }>;

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
	z.union([
		z.string(),
		z.number().finite(),
		z.boolean(),
		z.null(),
		z.array(jsonValueSchema),
		z.record(z.string(), jsonValueSchema)
	])
);

export const slotSourceSchema = z.strictObject({
	kind: z.enum([
		'user_text',
		'user_selected_candidate',
		'quick_action',
		'business_context',
		'application_default',
		'derived'
	]),
	detail: z.string().max(200).optional()
});
export type SlotSource = Readonly<z.infer<typeof slotSourceSchema>>;

export const slotStateSchema = z.discriminatedUnion('status', [
	z.strictObject({ status: z.literal('missing') }),
	z.strictObject({ status: z.literal('candidate'), raw: jsonValueSchema }),
	z.strictObject({
		status: z.literal('blocked'),
		dependsOn: z.array(z.string().min(1).max(80)).min(1).max(6)
	}),
	z.strictObject({
		status: z.literal('ambiguous'),
		candidates: z.array(jsonValueSchema).min(2).max(100)
	}),
	z.strictObject({ status: z.literal('invalid'), reasonCode: z.string().min(1).max(80) }),
	z.strictObject({
		status: z.literal('resolved'),
		value: jsonValueSchema,
		source: slotSourceSchema
	})
]);
export type SlotState = Readonly<z.infer<typeof slotStateSchema>>;
export type SlotCollection = Readonly<Record<string, SlotState>>;

const slotCollectionSchema = z.record(z.string().min(1).max(80), slotStateSchema);

export type ResolvedBusinessRequest = Readonly<{
	routeKind: AgentBusinessRouteKind;
	intent: AgentBusinessIntent;
	responseMode?: 'analysis' | 'data_only';
	slots: Readonly<Record<string, JsonValue>>;
}>;

const resolvedBusinessRequestSchema = z.strictObject({
	routeKind: agentBusinessRouteKindSchema,
	intent: agentBusinessIntentSchema,
	responseMode: z.enum(['analysis', 'data_only']).optional(),
	slots: z.record(z.string().min(1).max(80), jsonValueSchema)
});

export type EvidenceRecord = Readonly<{
	evidenceId: string;
	source: 'aliyun_dms_mcp' | 'weather_mcp' | 'hotel_rates_mcp';
	data: JsonValue;
}>;

const evidenceRecordSchema = z.strictObject({
	evidenceId: z.string().uuid(),
	source: z.enum(['aliyun_dms_mcp', 'weather_mcp', 'hotel_rates_mcp']),
	data: jsonValueSchema
});

export type RetryCheckpoint =
	| Readonly<{ kind: 'routing'; inputKind: 'prompt' | 'quick_action'; inputValue: string }>
	| Readonly<{
			kind: 'resolving_slots';
			routeKind: AgentBusinessRouteKind;
			intent: AgentBusinessIntent;
			responseMode?: 'analysis' | 'data_only';
			slots: SlotCollection;
	  }>
	| Readonly<{
			kind: 'executing';
			request: ResolvedBusinessRequest;
			evidence: readonly EvidenceRecord[];
			followUpUsed: boolean;
	  }>
	| Readonly<{
			kind: 'answering';
			request: ResolvedBusinessRequest;
			evidence: readonly EvidenceRecord[];
			limitations: readonly string[];
	  }>;

const retryCheckpointSchema: z.ZodType<RetryCheckpoint> = z.discriminatedUnion('kind', [
	z.strictObject({
		kind: z.literal('routing'),
		inputKind: z.enum(['prompt', 'quick_action']),
		inputValue: z.string().min(1).max(20_000)
	}),
	z.strictObject({
		kind: z.literal('resolving_slots'),
		routeKind: agentBusinessRouteKindSchema,
		intent: agentBusinessIntentSchema,
		responseMode: z.enum(['analysis', 'data_only']).optional(),
		slots: slotCollectionSchema
	}),
	z.strictObject({
		kind: z.literal('executing'),
		request: resolvedBusinessRequestSchema,
		evidence: z.array(evidenceRecordSchema),
		followUpUsed: z.boolean()
	}),
	z.strictObject({
		kind: z.literal('answering'),
		request: resolvedBusinessRequestSchema,
		evidence: z.array(evidenceRecordSchema),
		limitations: z.array(z.string().min(1).max(500)).max(10)
	})
]);

export type BusinessExecutionState =
	| Readonly<{
			status: 'routing';
			inputKind: 'prompt' | 'quick_action';
			inputValue: string;
	  }>
	| Readonly<{
			status: 'resolving_slots';
			routeKind: AgentBusinessRouteKind;
			intent: AgentBusinessIntent | null;
			responseMode?: 'analysis' | 'data_only';
			slots: SlotCollection;
	  }>
	| Readonly<{
			status: 'awaiting_clarification';
			routeKind: AgentBusinessRouteKind;
			intent: AgentBusinessIntent | null;
			responseMode?: 'analysis' | 'data_only';
			slots: SlotCollection;
			clarification: AgentPendingClarification;
	  }>
	| Readonly<{ status: 'ready'; request: ResolvedBusinessRequest }>
	| Readonly<{
			status: 'executing';
			request: ResolvedBusinessRequest;
			evidence: readonly EvidenceRecord[];
			followUpUsed: boolean;
	  }>
	| Readonly<{
			status: 'validating_evidence';
			request: ResolvedBusinessRequest;
			evidence: readonly EvidenceRecord[];
			followUpUsed: boolean;
	  }>
	| Readonly<{
			status: 'answering';
			mode: 'general' | 'write_denied' | 'grounded' | 'limited' | 'no_data';
			request: ResolvedBusinessRequest | null;
			evidence: readonly EvidenceRecord[];
			limitations: readonly string[];
	  }>
	| Readonly<{ status: 'completed'; assistantMessageId: string }>
	| Readonly<{
			status: 'failed';
			reasonCode: string;
			retryable: boolean;
			retryCheckpoint: RetryCheckpoint | null;
	  }>
	| Readonly<{ status: 'cancelled' }>;

export const businessExecutionStateSchema: z.ZodType<BusinessExecutionState> = z.discriminatedUnion(
	'status',
	[
		z.strictObject({
			status: z.literal('routing'),
			inputKind: z.enum(['prompt', 'quick_action']),
			inputValue: z.string().min(1).max(20_000)
		}),
		z.strictObject({
			status: z.literal('resolving_slots'),
			routeKind: agentBusinessRouteKindSchema,
			intent: agentBusinessIntentSchema.nullable(),
			responseMode: z.enum(['analysis', 'data_only']).optional(),
			slots: slotCollectionSchema
		}),
		z.strictObject({
			status: z.literal('awaiting_clarification'),
			routeKind: agentBusinessRouteKindSchema,
			intent: agentBusinessIntentSchema.nullable(),
			responseMode: z.enum(['analysis', 'data_only']).optional(),
			slots: slotCollectionSchema,
			clarification: agentPendingClarificationSchema
		}),
		z.strictObject({ status: z.literal('ready'), request: resolvedBusinessRequestSchema }),
		z.strictObject({
			status: z.literal('executing'),
			request: resolvedBusinessRequestSchema,
			evidence: z.array(evidenceRecordSchema),
			followUpUsed: z.boolean()
		}),
		z.strictObject({
			status: z.literal('validating_evidence'),
			request: resolvedBusinessRequestSchema,
			evidence: z.array(evidenceRecordSchema),
			followUpUsed: z.boolean()
		}),
		z.strictObject({
			status: z.literal('answering'),
			mode: z.enum(['general', 'write_denied', 'grounded', 'limited', 'no_data']),
			request: resolvedBusinessRequestSchema.nullable(),
			evidence: z.array(evidenceRecordSchema),
			limitations: z.array(z.string().min(1).max(500)).max(10)
		}),
		z.strictObject({
			status: z.literal('completed'),
			assistantMessageId: z.string().uuid()
		}),
		z.strictObject({
			status: z.literal('failed'),
			reasonCode: z.string().min(1).max(80),
			retryable: z.boolean(),
			retryCheckpoint: retryCheckpointSchema.nullable().default(null)
		}),
		z.strictObject({ status: z.literal('cancelled') })
	]
);

export type RouteProposal = Readonly<{
	routeKind: AgentBusinessRouteKind;
	intent: AgentBusinessIntent | null;
	responseMode?: 'analysis' | 'data_only';
	slots: SlotCollection;
}>;

export type EvidenceAssessment =
	| Readonly<{ status: 'sufficient'; limitations: readonly string[] }>
	| Readonly<{ status: 'no_data' }>
	| Readonly<{ status: 'needs_more_data'; limitation: string }>
	| Readonly<{ status: 'inconclusive'; limitations: readonly string[] }>
	| Readonly<{ status: 'rejected'; reasonCode: string }>;

export type BusinessExecutionEvent =
	| Readonly<{ type: 'route_classified'; proposal: RouteProposal }>
	| Readonly<{
			type: 'slots_need_clarification';
			slots: SlotCollection;
			clarification: AgentPendingClarification;
	  }>
	| Readonly<{ type: 'slots_ready'; request: ResolvedBusinessRequest }>
	| Readonly<{ type: 'clarification_submitted'; answers: Readonly<Record<string, JsonValue>> }>
	| Readonly<{ type: 'workflow_started' }>
	| Readonly<{ type: 'workflow_completed'; evidence: readonly EvidenceRecord[] }>
	| Readonly<{ type: 'evidence_validated'; assessment: EvidenceAssessment }>
	| Readonly<{ type: 'answer_completed'; assistantMessageId: string }>
	| Readonly<{ type: 'execution_failed'; reasonCode: string; retryable: boolean }>
	| Readonly<{ type: 'execution_retry_requested' }>
	| Readonly<{ type: 'execution_cancelled' }>;

export type PersistedBusinessExecutionEvent = Readonly<{
	type: BusinessExecutionEvent['type'];
	previousStatus: BusinessExecutionState['status'];
	nextStatus: BusinessExecutionState['status'];
	version: number;
}>;

export class InvalidBusinessExecutionTransitionError extends Error {
	constructor(status: BusinessExecutionState['status'], eventType: BusinessExecutionEvent['type']) {
		super(`Business execution cannot apply ${eventType} while ${status}`);
		this.name = 'InvalidBusinessExecutionTransitionError';
	}
}

function mergeClarificationAnswers(
	state: Extract<BusinessExecutionState, { status: 'awaiting_clarification' }>,
	answers: Readonly<Record<string, JsonValue>>
): SlotCollection {
	const requested = new Map(state.clarification.fields.map((field) => [field.slot, field]));
	for (const key of Object.keys(answers)) {
		const field = requested.get(key);
		if (!field) throw new Error(`Clarification did not request slot ${key}`);
		const value = answers[key];
		if (field.kind === 'single_choice') {
			if (typeof value !== 'string' || !field.choices.some((choice) => choice.value === value)) {
				throw new Error(`Clarification answer for ${key} is not an allowed choice`);
			}
		}
		if (field.kind === 'number') {
			if (
				typeof value !== 'number' ||
				(field.integer && !Number.isInteger(value)) ||
				(field.min !== undefined && value < field.min) ||
				(field.max !== undefined && value > field.max)
			) {
				throw new Error(`Clarification answer for ${key} is outside the allowed range`);
			}
		}
		if (field.kind === 'text' && (typeof value !== 'string' || value.length > field.maxLength)) {
			throw new Error(`Clarification answer for ${key} is invalid text`);
		}
		if (
			field.kind === 'date' &&
			(typeof value !== 'string' ||
				!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
				(field.min !== undefined && value < field.min) ||
				(field.max !== undefined && value > field.max))
		) {
			throw new Error(`Clarification answer for ${key} is not a local date`);
		}
		if (
			field.kind === 'date_range' &&
			(!isJsonRecord(value) ||
				typeof value.start !== 'string' ||
				typeof value.end !== 'string' ||
				!/^\d{4}-\d{2}-\d{2}$/.test(value.start) ||
				!/^\d{4}-\d{2}-\d{2}$/.test(value.end) ||
				(field.min !== undefined && value.start < field.min) ||
				(field.max !== undefined && value.end > field.max) ||
				value.start > value.end)
		) {
			throw new Error(`Clarification answer for ${key} is not a valid date range`);
		}
	}
	for (const field of state.clarification.fields) {
		if (field.required && !(field.slot in answers)) {
			throw new Error(`Clarification answer for ${field.slot} is required`);
		}
	}
	return Object.fromEntries(
		Object.entries(state.slots).map(([key, slot]) => {
			if (!(key in answers)) return [key, slot];
			const field = requested.get(key);
			const value = answers[key] ?? null;
			return [
				key,
				field?.kind === 'date' || (field?.kind === 'text' && key === 'hotelReference')
					? { status: 'candidate' as const, raw: value }
					: {
							status: 'resolved' as const,
							value,
							source: { kind: 'user_selected_candidate' as const }
						}
			];
		})
	);
}

function isJsonRecord(value: JsonValue | undefined): value is Readonly<Record<string, JsonValue>> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkpointFromState(state: BusinessExecutionState): RetryCheckpoint | null {
	switch (state.status) {
		case 'routing':
			return { kind: 'routing', inputKind: state.inputKind, inputValue: state.inputValue };
		case 'resolving_slots':
			return state.intent
				? {
						kind: 'resolving_slots',
						routeKind: state.routeKind,
						intent: state.intent,
						responseMode: state.responseMode,
						slots: state.slots
					}
				: null;
		case 'ready':
			return {
				kind: 'executing',
				request: state.request,
				evidence: [],
				followUpUsed: false
			};
		case 'executing':
			return {
				kind: 'executing',
				request: state.request,
				evidence: state.evidence,
				followUpUsed: state.followUpUsed
			};
		case 'validating_evidence':
			return {
				kind: 'executing',
				request: state.request,
				evidence: state.evidence,
				followUpUsed: state.followUpUsed
			};
		case 'answering':
			return state.mode === 'grounded' && state.request
				? {
						kind: 'answering',
						request: state.request,
						evidence: state.evidence,
						limitations: state.limitations
					}
				: null;
		case 'awaiting_clarification':
		case 'completed':
		case 'failed':
		case 'cancelled':
			return null;
	}
}

function restoreRetryCheckpoint(checkpoint: RetryCheckpoint): BusinessExecutionState {
	switch (checkpoint.kind) {
		case 'routing':
			return {
				status: 'routing',
				inputKind: checkpoint.inputKind,
				inputValue: checkpoint.inputValue
			};
		case 'resolving_slots':
			return {
				status: 'resolving_slots',
				routeKind: checkpoint.routeKind,
				intent: checkpoint.intent,
				responseMode: checkpoint.responseMode,
				slots: checkpoint.slots
			};
		case 'executing':
			if (
				typeof checkpoint.request.slots.hotelReference === 'string' &&
				!/^[0-9]+$/.test(checkpoint.request.slots.hotelReference)
			) {
				return {
					status: 'resolving_slots',
					routeKind: checkpoint.request.routeKind,
					intent: checkpoint.request.intent,
					responseMode: checkpoint.request.responseMode,
					slots: Object.fromEntries(
						Object.entries(checkpoint.request.slots).map(([name, value]) => [
							name,
							name === 'hotelReference'
								? { status: 'candidate' as const, raw: value }
								: {
										status: 'resolved' as const,
										value,
										source: { kind: 'derived' as const, detail: 'retry_checkpoint' }
									}
						])
					)
				};
			}
			return {
				status: 'executing',
				request: checkpoint.request,
				evidence: checkpoint.evidence,
				followUpUsed: checkpoint.followUpUsed
			};
		case 'answering':
			return {
				status: 'answering',
				mode: 'grounded',
				request: checkpoint.request,
				evidence: checkpoint.evidence,
				limitations: checkpoint.limitations
			};
	}
}

export function transitionBusinessExecution(
	state: BusinessExecutionState,
	event: BusinessExecutionEvent
): BusinessExecutionState {
	if (
		event.type === 'execution_cancelled' &&
		!['completed', 'failed', 'cancelled'].includes(state.status)
	) {
		return { status: 'cancelled' };
	}
	if (
		event.type === 'execution_failed' &&
		!['completed', 'failed', 'cancelled'].includes(state.status)
	) {
		const retryCheckpoint = event.retryable ? checkpointFromState(state) : null;
		return {
			status: 'failed',
			reasonCode: event.reasonCode,
			retryable: event.retryable && retryCheckpoint !== null,
			retryCheckpoint
		};
	}

	switch (state.status) {
		case 'routing':
			if (event.type !== 'route_classified') break;
			if (event.proposal.routeKind === 'business_write') {
				return {
					status: 'answering',
					mode: 'write_denied',
					request: null,
					evidence: [],
					limitations: ['当前 Hotel Agent 不支持业务写操作。']
				};
			}
			if (
				event.proposal.routeKind === 'general_conversation' ||
				event.proposal.routeKind === 'hotel_knowledge' ||
				event.proposal.routeKind === 'unclear'
			) {
				return {
					status: 'answering',
					mode: 'general',
					request: null,
					evidence: [],
					limitations: []
				};
			}
			return { status: 'resolving_slots', ...event.proposal };
		case 'resolving_slots':
			if (event.type === 'slots_need_clarification') {
				return {
					status: 'awaiting_clarification',
					routeKind: state.routeKind,
					intent: state.intent,
					responseMode: state.responseMode,
					slots: event.slots,
					clarification: event.clarification
				};
			}
			if (event.type === 'slots_ready') return { status: 'ready', request: event.request };
			break;
		case 'awaiting_clarification':
			if (event.type !== 'clarification_submitted') break;
			return {
				status: 'resolving_slots',
				routeKind: state.routeKind,
				intent: state.intent,
				responseMode: state.responseMode,
				slots: mergeClarificationAnswers(state, event.answers)
			};
		case 'ready':
			if (event.type !== 'workflow_started') break;
			return {
				status: 'executing',
				request: state.request,
				evidence: [],
				followUpUsed: false
			};
		case 'executing':
			if (event.type !== 'workflow_completed') break;
			return {
				status: 'validating_evidence',
				request: state.request,
				evidence: [...state.evidence, ...event.evidence],
				followUpUsed: state.followUpUsed
			};
		case 'validating_evidence':
			if (event.type !== 'evidence_validated') break;
			if (event.assessment.status === 'needs_more_data' && !state.followUpUsed) {
				return { ...state, status: 'executing', followUpUsed: true };
			}
			if (event.assessment.status === 'rejected') {
				return {
					status: 'failed',
					reasonCode: event.assessment.reasonCode,
					retryable: false,
					retryCheckpoint: null
				};
			}
			return {
				status: 'answering',
				mode:
					event.assessment.status === 'sufficient'
						? 'grounded'
						: event.assessment.status === 'no_data'
							? 'no_data'
							: 'limited',
				request: state.request,
				evidence: state.evidence,
				limitations:
					event.assessment.status === 'no_data'
						? []
						: event.assessment.status === 'needs_more_data'
							? [event.assessment.limitation]
							: event.assessment.limitations
			};
		case 'answering':
			if (event.type !== 'answer_completed') break;
			return { status: 'completed', assistantMessageId: event.assistantMessageId };
		case 'failed':
			if (event.type !== 'execution_retry_requested') break;
			if (!state.retryable || !state.retryCheckpoint) break;
			return restoreRetryCheckpoint(state.retryCheckpoint);
		case 'completed':
		case 'cancelled':
			break;
	}
	throw new InvalidBusinessExecutionTransitionError(state.status, event.type);
}
