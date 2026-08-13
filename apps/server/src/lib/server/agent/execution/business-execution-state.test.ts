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
});
