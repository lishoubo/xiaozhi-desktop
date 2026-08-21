import { describe, expect, it } from 'vitest';
import type { AgentPendingClarification } from '@hotel-butler/api';
import {
	businessExecutionStateSchema,
	InvalidBusinessExecutionTransitionError,
	transitionBusinessExecution,
	type BusinessExecutionState,
	type ResolvedBusinessRequest
} from './business-execution-state';

const request: ResolvedBusinessRequest = {
	routeKind: 'business_read',
	intent: 'public_hotel_rates',
	slots: { hotel: 'hotel-2', checkIn: '2026-08-14', checkOut: '2026-08-16' }
};

const clarification: AgentPendingClarification = {
	interactionId: '55555555-5555-4555-8555-555555555555',
	anchorMessageId: '22222222-2222-4222-8222-222222222222',
	version: 3,
	prompt: '请选择酒店。',
	fields: [
		{
			kind: 'single_choice',
			slot: 'hotel',
			label: '酒店',
			required: true,
			choices: [
				{ value: 'hotel-1', label: '杭州西湖店' },
				{ value: 'hotel-2', label: '杭州西湖景区店' }
			]
		}
	],
	expiresAt: '2026-08-14T00:00:00.000+08:00'
};

describe('business execution state machine', () => {
	it('routes a business read into slot resolution and a write into deterministic denial', () => {
		const routing: BusinessExecutionState = {
			status: 'routing',
			inputKind: 'prompt',
			inputValue: '查酒店价格'
		};

		expect(
			transitionBusinessExecution(routing, {
				type: 'route_classified',
				proposal: {
					routeKind: 'business_read',
					intent: 'public_hotel_rates',
					slots: { hotel: { status: 'candidate', raw: '西湖店' } }
				}
			})
		).toMatchObject({ status: 'resolving_slots', intent: 'public_hotel_rates' });

		expect(
			transitionBusinessExecution(routing, {
				type: 'route_classified',
				proposal: { routeKind: 'business_write', intent: null, slots: {} }
			})
		).toMatchObject({ status: 'answering', mode: 'write_denied' });
	});

	it('pauses for clarification and merges only the requested answers before resolving again', () => {
		const resolving: BusinessExecutionState = {
			status: 'resolving_slots',
			routeKind: 'business_read',
			intent: 'public_hotel_rates',
			slots: {
				hotel: { status: 'ambiguous', candidates: ['hotel-1', 'hotel-2'] },
				checkIn: { status: 'resolved', value: '2026-08-14', source: { kind: 'user_text' } }
			}
		};
		const waiting = transitionBusinessExecution(resolving, {
			type: 'slots_need_clarification',
			slots: resolving.slots,
			clarification
		});

		expect(waiting.status).toBe('awaiting_clarification');
		const resumed = transitionBusinessExecution(waiting, {
			type: 'clarification_submitted',
			answers: { hotel: 'hotel-2' }
		});
		expect(resumed).toMatchObject({
			status: 'resolving_slots',
			slots: {
				hotel: { status: 'resolved', value: 'hotel-2' },
				checkIn: { status: 'resolved', value: '2026-08-14' }
			}
		});
	});

	it('allows one evidence follow-up and then produces a limited answer', () => {
		const validating: BusinessExecutionState = {
			status: 'validating_evidence',
			request,
			evidence: [],
			followUpUsed: false
		};
		const followUp = transitionBusinessExecution(validating, {
			type: 'evidence_validated',
			assessment: { status: 'needs_more_data', limitation: '缺少税费口径' }
		});
		expect(followUp).toMatchObject({ status: 'executing', followUpUsed: true });

		const secondValidation = transitionBusinessExecution(
			{ ...validating, followUpUsed: true },
			{
				type: 'evidence_validated',
				assessment: { status: 'needs_more_data', limitation: '仍缺少税费口径' }
			}
		);
		expect(secondValidation).toMatchObject({
			status: 'answering',
			mode: 'limited',
			limitations: ['仍缺少税费口径']
		});
	});

	it('answers a confirmed no-data result without another collection pass', () => {
		const validating: BusinessExecutionState = {
			status: 'validating_evidence',
			request,
			evidence: [],
			followUpUsed: false
		};

		expect(
			transitionBusinessExecution(validating, {
				type: 'evidence_validated',
				assessment: { status: 'no_data' }
			})
		).toMatchObject({ status: 'answering', mode: 'no_data', limitations: [] });
	});

	it('rejects a clarification value outside the server-owned choices', () => {
		const waiting: BusinessExecutionState = {
			status: 'awaiting_clarification',
			routeKind: 'business_read',
			intent: 'public_hotel_rates',
			slots: { hotel: { status: 'ambiguous', candidates: ['hotel-1', 'hotel-2'] } },
			clarification
		};
		expect(() =>
			transitionBusinessExecution(waiting, {
				type: 'clarification_submitted',
				answers: { hotel: 'hotel-3' }
			})
		).toThrow(/allowed choice/);
	});

	it('keeps a typed hotel name unresolved until the hotel directory maps it to an ID', () => {
		const hotelClarification: AgentPendingClarification = {
			...clarification,
			fields: [
				{
					kind: 'text',
					slot: 'hotelReference',
					label: '酒店',
					required: true,
					maxLength: 200
				}
			]
		};
		const waiting: BusinessExecutionState = {
			status: 'awaiting_clarification',
			routeKind: 'business_read',
			intent: 'hotel_operating_summary',
			slots: { hotelReference: { status: 'missing' } },
			clarification: hotelClarification
		};

		expect(
			transitionBusinessExecution(waiting, {
				type: 'clarification_submitted',
				answers: { hotelReference: '包头璞禾咖啡酒店（禧瑞都店）' }
			})
		).toMatchObject({
			status: 'resolving_slots',
			slots: {
				hotelReference: {
					status: 'candidate',
					raw: '包头璞禾咖啡酒店（禧瑞都店）'
				}
			}
		});
	});

	it('rejects illegal and terminal transitions', () => {
		expect(() =>
			transitionBusinessExecution(
				{ status: 'ready', request },
				{ type: 'answer_completed', assistantMessageId: '22222222-2222-4222-8222-222222222222' }
			)
		).toThrow(InvalidBusinessExecutionTransitionError);
		expect(() =>
			transitionBusinessExecution({ status: 'cancelled' }, { type: 'execution_cancelled' })
		).toThrow(InvalidBusinessExecutionTransitionError);
	});

	it('round-trips persisted waiting state through the strict schema', () => {
		const state = {
			status: 'awaiting_clarification',
			routeKind: 'business_read',
			intent: 'public_hotel_rates',
			slots: { hotel: { status: 'ambiguous', candidates: ['hotel-1', 'hotel-2'] } },
			clarification
		};

		expect(businessExecutionStateSchema.parse(state)).toEqual(state);
		expect(businessExecutionStateSchema.safeParse({ ...state, hiddenPrompt: 'no' }).success).toBe(
			false
		);
	});

	it('stores an executing checkpoint on retryable failure and restores it explicitly', () => {
		const executing: BusinessExecutionState = {
			status: 'executing',
			request,
			evidence: [],
			followUpUsed: false
		};
		const failed = transitionBusinessExecution(executing, {
			type: 'execution_failed',
			reasonCode: 'mcp_timeout',
			retryable: true
		});

		expect(failed).toEqual({
			status: 'failed',
			reasonCode: 'mcp_timeout',
			retryable: true,
			retryCheckpoint: {
				kind: 'executing',
				request,
				evidence: [],
				followUpUsed: false
			}
		});
		expect(transitionBusinessExecution(failed, { type: 'execution_retry_requested' })).toEqual(
			executing
		);
	});

	it('keeps validated evidence when retrying a transient validation failure', () => {
		const evidence = [
			{
				evidenceId: '11111111-1111-4111-8111-111111111111',
				source: 'aliyun_dms_mcp' as const,
				data: { toolName: 'query_hotel_operating_data_sql', data: [{ hotel_id: 4 }] }
			}
		];
		const validating: BusinessExecutionState = {
			status: 'validating_evidence',
			request,
			evidence,
			followUpUsed: false
		};
		const failed = transitionBusinessExecution(validating, {
			type: 'execution_failed',
			reasonCode: 'mcp_timeout',
			retryable: true
		});

		expect(transitionBusinessExecution(failed, { type: 'execution_retry_requested' })).toEqual({
			status: 'executing',
			request,
			evidence,
			followUpUsed: false
		});
	});

	it('re-resolves a legacy retry checkpoint that stored a hotel name as an ID', () => {
		const legacyRequest: ResolvedBusinessRequest = {
			routeKind: 'business_read',
			intent: 'hotel_operating_summary',
			slots: {
				hotelReference: '包头璞禾咖啡酒店（禧瑞都店）',
				dateRange: { start: '2026-08-13', end: '2026-08-14' }
			}
		};
		const failed = transitionBusinessExecution(
			{ status: 'executing', request: legacyRequest, evidence: [], followUpUsed: false },
			{ type: 'execution_failed', reasonCode: 'upstream_failure', retryable: true }
		);

		expect(
			transitionBusinessExecution(failed, { type: 'execution_retry_requested' })
		).toMatchObject({
			status: 'resolving_slots',
			intent: 'hotel_operating_summary',
			slots: {
				hotelReference: { status: 'candidate', raw: '包头璞禾咖啡酒店（禧瑞都店）' },
				dateRange: { status: 'resolved' }
			}
		});
	});

	it('retries grounded answering without discarding validated evidence', () => {
		const evidence = [
			{
				evidenceId: '77777777-7777-4777-8777-777777777777',
				source: 'hotel_rates_mcp' as const,
				data: { rates: [688] }
			}
		];
		const answering: BusinessExecutionState = {
			status: 'answering',
			mode: 'grounded',
			request,
			evidence,
			limitations: ['价格随时变化。']
		};
		const failed = transitionBusinessExecution(answering, {
			type: 'execution_failed',
			reasonCode: 'answer_timeout',
			retryable: true
		});

		expect(transitionBusinessExecution(failed, { type: 'execution_retry_requested' })).toEqual(
			answering
		);
	});

	it('does not make an unsafe or non-retryable state restorable', () => {
		const failed = transitionBusinessExecution(
			{
				status: 'answering',
				mode: 'write_denied',
				request: null,
				evidence: [],
				limitations: ['不支持写操作。']
			},
			{ type: 'execution_failed', reasonCode: 'unsupported', retryable: true }
		);

		expect(failed).toEqual({
			status: 'failed',
			reasonCode: 'unsupported',
			retryable: false,
			retryCheckpoint: null
		});
		expect(() =>
			transitionBusinessExecution(failed, { type: 'execution_retry_requested' })
		).toThrow(InvalidBusinessExecutionTransitionError);
	});
});
