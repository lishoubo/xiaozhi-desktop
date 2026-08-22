import type { AgentRunEvent } from '@hotel-butler/api';
import { describe, expect, it } from 'vitest';
import {
	buildActiveRunDraft,
	buildAgentExecutionTraces,
	buildRetainedFailedDraftMessages
} from './agent-execution-trace';

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

	it('retains the safe retry metadata from a persisted failure event', () => {
		const [trace] = buildAgentExecutionTraces(
			[
				{
					id: runId,
					userMessageId,
					status: 'failed',
					createdAt: new Date('2026-08-12T03:00:00.000Z'),
					completedAt: new Date('2026-08-12T03:00:01.000Z')
				}
			],
			[
				event({
					type: 'run_failed',
					code: 'data_source_unavailable',
					message: 'DMS MCP 经营数据查询暂时不可用。',
					recovery: 'retry',
					retryable: true
				})
			]
		);

		expect(trace).toMatchObject({
			status: 'failed',
			failure: {
				code: 'data_source_unavailable',
				message: 'DMS MCP 经营数据查询暂时不可用。',
				recovery: 'retry',
				retryable: true
			}
		});
	});

	it('projects a failed tool separately from a completed tool', () => {
		const [trace] = buildAgentExecutionTraces(
			[
				{
					id: runId,
					userMessageId,
					status: 'failed',
					createdAt: new Date('2026-08-12T03:00:00.000Z'),
					completedAt: new Date('2026-08-12T03:00:01.000Z')
				}
			],
			[
				event({
					type: 'tool_started',
					toolCallId: 'query-1',
					toolName: 'query_hotel_operating_data_sql'
				}),
				event({
					type: 'tool_failed',
					toolCallId: 'query-1',
					toolName: 'query_hotel_operating_data_sql',
					code: 'query_rejected',
					summary: '查询未通过安全校验'
				})
			]
		);

		expect(trace.steps).toEqual([
			{
				toolCallId: 'query-1',
				toolName: 'query_hotel_operating_data_sql',
				status: 'failed',
				failureCode: 'query_rejected',
				summary: '查询未通过安全校验'
			}
		]);
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
			retainedContentOnFailure: null,
			lastEventId: uiEvent.id
		});
	});

	it('records only the validated text before upstream analysis for failure recovery', () => {
		const spec = {
			root: 'root',
			state: {},
			elements: { root: { type: 'Table' as const, props: {}, children: [], visible: true } }
		};
		const events = [
			event({ type: 'text_delta', delta: '可靠经营摘要' }),
			event({ type: 'ui_spec', spec }),
			event({
				type: 'tool_started',
				toolCallId: 'analysis-1',
				toolName: 'upstream_llm_analysis'
			}),
			event({ type: 'text_delta', delta: '未完成的模型分析' })
		];

		expect(buildActiveRunDraft(runId, events)).toMatchObject({
			content: '可靠经营摘要未完成的模型分析',
			ui: spec,
			retainedContentOnFailure: '可靠经营摘要'
		});
	});
});

describe('buildRetainedFailedDraftMessages', () => {
	it('restores validated text and UI before analysis while excluding partial model output', () => {
		const spec = {
			root: 'root',
			state: {},
			elements: { root: { type: 'MetricGrid' as const, props: {}, children: [], visible: true } }
		};
		const uiEvent = event({ type: 'ui_spec', spec });
		const messages = buildRetainedFailedDraftMessages(
			[
				{
					id: runId,
					businessExecutionId: '77777777-7777-4777-8777-777777777777',
					userMessageId,
					status: 'failed',
					createdAt: new Date('2026-08-12T03:00:00.000Z'),
					completedAt: new Date('2026-08-12T03:02:00.000Z')
				}
			],
			[
				event({ type: 'text_delta', delta: '可靠经营摘要' }),
				uiEvent,
				event({
					type: 'tool_started',
					toolCallId: 'analysis-1',
					toolName: 'upstream_llm_analysis'
				}),
				event({ type: 'text_delta', delta: '未完成的模型分析' }),
				event({ type: 'run_failed', message: '分析超时', retryable: true })
			]
		);

		expect(messages).toEqual([
			expect.objectContaining({
				id: uiEvent.id,
				conversationId,
				role: 'assistant',
				content: '可靠经营摘要',
				ui: spec
			})
		]);
	});
});
