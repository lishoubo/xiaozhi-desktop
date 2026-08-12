import type { AgentRunEvent } from '@hotel-butler/api';
import { describe, expect, it } from 'vitest';
import { buildActiveRunDraft, buildAgentExecutionTraces } from './agent-execution-trace';

const runId = '33333333-3333-4333-8333-333333333333';
const conversationId = '44444444-4444-4444-8444-444444444444';
const userMessageId = '55555555-5555-4555-8555-555555555555';
const assistantMessageId = '66666666-6666-4666-8666-666666666666';

type EventPayload<T extends AgentRunEvent = AgentRunEvent> = T extends AgentRunEvent
	? Omit<T, 'id' | 'runId' | 'conversationId' | 'createdAt'>
	: never;

function event(value: EventPayload): AgentRunEvent {
	return {
		...value,
		id: crypto.randomUUID(),
		runId,
		conversationId,
		createdAt: '2026-08-12T03:00:01.000Z'
	} as AgentRunEvent;
}

describe('buildAgentExecutionTraces', () => {
	it('projects persisted tool lifecycle and terminal message linkage', () => {
		const traces = buildAgentExecutionTraces(
			[
				{
					id: runId,
					userMessageId,
					status: 'completed',
					createdAt: new Date('2026-08-12T03:00:00.000Z'),
					completedAt: new Date('2026-08-12T03:00:02.000Z')
				}
			],
			[
				event({ type: 'run_started' }),
				event({
					type: 'tool_started',
					toolCallId: 'tool-1',
					toolName: 'query_hotel_operating_data'
				}),
				event({
					type: 'tool_completed',
					toolCallId: 'tool-1',
					toolName: 'query_hotel_operating_data',
					summary: '酒店经营数据查询完成'
				}),
				event({
					type: 'run_completed',
					message: {
						id: assistantMessageId,
						conversationId,
						role: 'assistant',
						content: '结果',
						ui: null,
						createdAt: '2026-08-12T03:00:02.000Z'
					}
				})
			]
		);

		expect(traces).toEqual([
			expect.objectContaining({
				runId,
				userMessageId,
				assistantMessageId,
				status: 'completed',
				steps: [
					{
						toolCallId: 'tool-1',
						toolName: 'query_hotel_operating_data',
						status: 'completed',
						summary: '酒店经营数据查询完成'
					}
				]
			})
		]);
	});

	it('preserves a cancelled terminal status without an assistant message', () => {
		const [trace] = buildAgentExecutionTraces(
			[
				{
					id: runId,
					userMessageId,
					status: 'cancelled',
					createdAt: new Date('2026-08-12T03:00:00.000Z'),
					completedAt: new Date('2026-08-12T03:00:01.000Z')
				}
			],
			[event({ type: 'run_started' }), event({ type: 'run_cancelled' })]
		);

		expect(trace).toMatchObject({ status: 'cancelled', assistantMessageId: null });
	});
});

describe('buildActiveRunDraft', () => {
	it('restores partial text, UI preparation and the persisted replay cursor', () => {
		const spec = {
			root: 'root',
			state: {},
			elements: { root: { type: 'MetricGrid', props: {}, children: [], visible: true } }
		};
		const textEvent = event({ type: 'text_delta', delta: '正在查询' });
		const toolEvent = event({
			type: 'tool_started',
			toolCallId: 'render-1',
			toolName: 'render_hotel_ui'
		});
		const uiEvent = event({
			type: 'ui_spec',
			spec
		});

		expect(buildActiveRunDraft(runId, [textEvent, toolEvent, uiEvent])).toEqual({
			runId,
			content: '正在查询',
			ui: spec,
			preparingUi: false,
			lastEventId: uiEvent.id
		});
	});
});
