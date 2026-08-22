import type { GenerativeUiSpec } from '@hotel-butler/api';
import { describe, expect, it, vi } from 'vitest';
import {
	analysisCompletionIssue,
	blockedWorkflowToolCalls,
	DuplicateUiRenderError,
	completeGroundedAnswerAfterUi,
	groundedAnalysisWritingInstructions,
	hotelDataCollectionToolChoice,
	loadMcpToolsWithSingleRefresh,
	mcpFailureFingerprint,
	isLocalToolAllowed,
	normalizeAgentStreamFailure,
	shouldRecoverPartialCollection,
	recoverCompletedUiAfterRenderLimit,
	selectWorkflowToolNames,
	shouldLoadMcpTools,
	shouldLoadSkills,
	shouldRequireHotelDataQuery,
	shouldCaptureToolEvidence,
	shouldAbortRepeatedMcpFailure,
	shouldSuppressUiRenderCall,
	shouldSuppressWorkflowToolCall,
	shouldStopHotelDataCollection,
	shouldStopDuplicateUiRender,
	ToolCallChunkAccumulator,
	workflowMessages,
	workflowRecursionLimit,
	workflowToolCallBudget
} from './langchain-agent-runtime';
import { AgentProtocolError, AgentUpstreamError } from './agent-effect';
import { shouldForwardCollectionRuntimeEvent } from './agent-runtime';

describe('shouldLoadMcpTools', () => {
	it('denies MCP by default and only loads an explicit collection-phase allowlist', () => {
		expect(shouldLoadMcpTools({ allowedMcpCapabilities: [] })).toBe(false);
		expect(shouldLoadMcpTools({ allowedMcpCapabilities: ['hotel_data'] })).toBe(true);
		expect(
			shouldLoadMcpTools({ allowedMcpCapabilities: ['hotel_data'], validatedEvidence: [] })
		).toBe(false);
	});
});

describe('shouldLoadSkills', () => {
	it('loads skills only when the active intent explicitly names them', () => {
		expect(shouldLoadSkills({ allowedSkillNames: [] })).toBe(false);
		expect(shouldLoadSkills({ allowedSkillNames: ['night-audit'] })).toBe(true);
	});
});

describe('isLocalToolAllowed', () => {
	it('keeps local memory but excludes generative UI from general conversation', () => {
		const general = { allowedLocalToolNames: ['remember_long_term_memory'] as const };

		expect(isLocalToolAllowed(general, 'remember_long_term_memory')).toBe(true);
		expect(isLocalToolAllowed(general, 'render_hotel_ui')).toBe(false);
	});
});

const ui: GenerativeUiSpec = {
	root: 'root',
	state: {},
	elements: {
		root: { type: 'Table', props: {}, children: [], visible: true }
	}
};

describe('recoverCompletedUiAfterRenderLimit', () => {
	it('allows correction until a valid UI exists, then stops another render', () => {
		expect(shouldStopDuplicateUiRender(false, ['render_hotel_ui'])).toBe(false);
		expect(shouldStopDuplicateUiRender(true, ['query_weather'])).toBe(false);
		expect(shouldStopDuplicateUiRender(true, ['render_hotel_ui'])).toBe(true);
	});

	it('completes with the first UI when the model attempts to render again', () => {
		const error = new DuplicateUiRenderError();

		expect(recoverCompletedUiAfterRenderLimit(error, '天气数据已获取：', ui)).toEqual({
			content: '天气数据已获取：\n\n结果视图已经生成，请结合上方数据查看。',
			ui
		});
	});

	it('does not hide unrelated failures or a failed first render', () => {
		expect(recoverCompletedUiAfterRenderLimit(new Error('upstream'), '', ui)).toBeNull();
		expect(recoverCompletedUiAfterRenderLimit(new DuplicateUiRenderError(), '', null)).toBeNull();
	});
});

describe('completeGroundedAnswerAfterUi', () => {
	it('finishes the grounded answer as soon as its validated UI tool completes', () => {
		expect(completeGroundedAnswerAfterUi('', ui)).toEqual({
			content: '结果视图已经生成，请结合上方数据查看。',
			ui
		});
		expect(completeGroundedAnswerAfterUi('近 7 日趋势如下。', ui)).toEqual({
			content: '近 7 日趋势如下。\n\n结果视图已经生成，请结合上方数据查看。',
			ui
		});
	});
});

describe('analysisCompletionIssue', () => {
	it('rejects output-limit and empty analysis responses without rejecting complete text', () => {
		expect(analysisCompletionIssue('未完成的分析', 'length')).toBe('output_limit');
		expect(analysisCompletionIssue('   ', 'stop')).toBe('empty');
		expect(analysisCompletionIssue('经营趋势整体上升。', 'stop')).toBeNull();
	});
});

describe('groundedAnalysisWritingInstructions', () => {
	it('requires a concise conclusion-first professional Markdown structure', () => {
		const instructions = groundedAnalysisWritingInstructions();

		expect(instructions).toContain('## 核心结论');
		expect(instructions).toContain('## 关键发现');
		expect(instructions).toContain('## 经营建议');
		expect(instructions).toContain('## 数据口径');
		expect(instructions).toContain('避免连续大段文字');
		expect(instructions).toContain('没有证据的维度不要补齐');
		expect(instructions).toContain('NULL、空字符串、缺行和查询失败');
		expect(instructions).toContain('归因成交额不得改称全口径 GMV');
		expect(instructions).toContain('不得把稀疏、缺失或零值归因为同步中断');
	});
});

describe('selectWorkflowToolNames', () => {
	const available = [
		'list_hotel_data_tables',
		'describe_hotel_data_table',
		'generate_hotel_operating_data_sql',
		'query_hotel_operating_data_sql',
		'query_weather_forecast',
		'search_room_rates',
		'update_room_rate'
	];

	it('narrows evidence collection to the intent allowlist and removes MCP tools after validation', () => {
		const workflowRequest = {
			routeKind: 'business_read' as const,
			intent: 'hotel_operating_summary' as const,
			slots: {}
		};
		expect(selectWorkflowToolNames({ workflowRequest }, available)).toEqual([
			'query_hotel_operating_data_sql'
		]);
		expect(selectWorkflowToolNames({ workflowRequest, validatedEvidence: [] }, available)).toEqual([
			'render_hotel_ui'
		]);
	});
});

describe('shouldRequireHotelDataQuery', () => {
	const genericRequest = {
		routeKind: 'business_read' as const,
		intent: 'generic_hotel_data_query' as const,
		slots: {}
	};

	it('requires hotel-data workflows to execute the SQL query before the model may finish', () => {
		expect(shouldRequireHotelDataQuery(genericRequest, [])).toBe(true);
		expect(shouldRequireHotelDataQuery(genericRequest, ['list_hotel_data_tables'])).toBe(true);
		expect(shouldRequireHotelDataQuery(genericRequest, ['query_hotel_operating_data_sql'])).toBe(
			false
		);
		expect(
			shouldRequireHotelDataQuery({ ...genericRequest, intent: 'hotel_operating_summary' }, [
				'query_hotel_operating_data_sql'
			])
		).toBe(false);
	});

	it('requires verified local fields before the first generic business SQL query', () => {
		expect(hotelDataCollectionToolChoice(genericRequest, [])).toEqual({
			type: 'function',
			function: { name: 'describe_verified_hotel_data_tables' }
		});
		expect(
			hotelDataCollectionToolChoice(genericRequest, ['describe_verified_hotel_data_tables'])
		).toEqual({
			type: 'function',
			function: { name: 'query_hotel_operating_data_sql' }
		});
		expect(
			hotelDataCollectionToolChoice(genericRequest, [
				'list_hotel_data_tables',
				'describe_hotel_data_table'
			])
		).toEqual({
			type: 'function',
			function: { name: 'describe_verified_hotel_data_tables' }
		});
		expect(hotelDataCollectionToolChoice(genericRequest, ['query_hotel_operating_data_sql'])).toBe(
			'auto'
		);
	});

	it('queries directly when the routed metric already preloads verified tables', () => {
		expect(
			hotelDataCollectionToolChoice(
				{ ...genericRequest, slots: { metrics: '近日流量和转化情况' } },
				[],
				true
			)
		).toEqual({
			type: 'function',
			function: { name: 'query_hotel_operating_data_sql' }
		});
	});

	it('refreshes the MCP catalog once after a failed hotel-data discovery', async () => {
		const provider = {
			getTools: vi.fn().mockRejectedValue(new Error('empty catalog')),
			refreshTools: vi.fn().mockResolvedValue([{ name: 'query_hotel_operating_data_sql' }])
		};

		await expect(loadMcpToolsWithSingleRefresh(provider, ['hotel_data'])).resolves.toHaveLength(1);
		expect(provider.getTools).toHaveBeenCalledOnce();
		expect(provider.refreshTools).toHaveBeenCalledOnce();
	});

	it('does not force a hotel SQL query for unrelated workflows or general conversation', () => {
		expect(shouldRequireHotelDataQuery(undefined, [])).toBe(false);
		expect(
			shouldRequireHotelDataQuery({ ...genericRequest, intent: 'weather_operations_advice' }, [])
		).toBe(false);
	});
});

describe('hotel data collection convergence', () => {
	const genericRequest = {
		routeKind: 'business_read' as const,
		intent: 'generic_hotel_data_query' as const,
		slots: {}
	};

	it('stops broad hotel-data discovery after eight successful queries or three query rounds', () => {
		expect(shouldStopHotelDataCollection(genericRequest, 7, 2)).toBe(false);
		expect(shouldStopHotelDataCollection(genericRequest, 8, 1)).toBe(true);
		expect(shouldStopHotelDataCollection(genericRequest, 1, 3)).toBe(true);
		expect(
			shouldStopHotelDataCollection({ ...genericRequest, intent: 'hotel_operating_summary' }, 8, 3)
		).toBe(false);
		expect(shouldStopHotelDataCollection(undefined, 8, 3)).toBe(false);
	});
});

describe('tool evidence capture', () => {
	it('reassembles streamed tool arguments across chunks before evidence capture', () => {
		const accumulator = new ToolCallChunkAccumulator();

		accumulator.add({
			id: 'call-1',
			name: 'query_hotel_operating_data_sql',
			args: '{"script":"SELECT ',
			index: 0
		});
		accumulator.add({ args: 'hotel_id, exposure_cnt ', index: 0 });
		accumulator.add({ args: 'FROM fact_traffic_scene"}', index: 0 });

		expect(accumulator.take('call-1')).toEqual({
			trackingId: expect.any(String),
			name: 'query_hotel_operating_data_sql',
			args: { script: 'SELECT hotel_id, exposure_cnt FROM fact_traffic_scene' }
		});
	});

	it('keeps parallel streamed tool calls isolated by call index', () => {
		const accumulator = new ToolCallChunkAccumulator();

		accumulator.add({ id: 'call-1', name: 'query', args: '{"script":"A', index: 0 });
		accumulator.add({ id: 'call-2', name: 'query', args: '{"script":"B', index: 1 });
		accumulator.add({ args: '"}', index: 1 });
		accumulator.add({ args: '"}', index: 0 });

		expect(accumulator.take('call-1')?.args).toEqual({ script: 'A' });
		expect(accumulator.take('call-2')?.args).toEqual({ script: 'B' });
	});

	it('does not duplicate cumulative argument chunks', () => {
		const accumulator = new ToolCallChunkAccumulator();

		accumulator.add({ id: 'call-1', name: 'query', args: '{"script":"A', index: 0 });
		accumulator.add({ args: '{"script":"A"}', index: 0 });

		expect(accumulator.take('call-1')?.args).toEqual({ script: 'A' });
	});

	it('tracks unstable streamed ids as one lifecycle call when their index is unchanged', () => {
		const accumulator = new ToolCallChunkAccumulator();

		const first = accumulator.add({
			id: 'query_hotel_operating_data_sql_1',
			name: 'query_hotel_operating_data_sql',
			args: '{"script":"SELECT ',
			index: 0
		});
		const second = accumulator.add({
			id: 'query_hotel_operating_data_sql_2',
			args: 'hotel_id FROM fact_conversion_funnel"}',
			index: 0
		});

		expect(second?.trackingId).toBe(first?.trackingId);
		expect(accumulator.trackingId('query_hotel_operating_data_sql_2')).toBe(
			first?.trackingId
		);
		expect(accumulator.take('query_hotel_operating_data_sql_2')).toEqual({
			trackingId: first?.trackingId,
			name: 'query_hotel_operating_data_sql',
			args: { script: 'SELECT hotel_id FROM fact_conversion_funnel' }
		});
	});

	it('assigns a new lifecycle identity when a later model round reuses the same index', () => {
		const accumulator = new ToolCallChunkAccumulator();
		const first = accumulator.add({ id: 'call-1', name: 'query', args: '{}', index: 0 });

		accumulator.take('call-1');
		const second = accumulator.add({ id: 'call-2', name: 'query', args: '{}', index: 0 });

		expect(second?.trackingId).not.toBe(first?.trackingId);
	});

	it('does not treat an error ToolMessage as business evidence', () => {
		expect(shouldCaptureToolEvidence('error')).toBe(false);
		expect(shouldCaptureToolEvidence('success')).toBe(true);
		expect(shouldCaptureToolEvidence(undefined)).toBe(true);
		expect(
			shouldCaptureToolEvidence(
				undefined,
				'ToolException: Error calling tool executeScript: database rejected query'
			)
		).toBe(false);
	});

	it('stops retrying the same MCP tool after one corrective retry', () => {
		expect(shouldAbortRepeatedMcpFailure(1)).toBe(false);
		expect(shouldAbortRepeatedMcpFailure(2)).toBe(true);
	});

	it('does not combine failures from different SQL attempts', () => {
		expect(
			mcpFailureFingerprint(
				'query_hotel_operating_data_sql',
				{ script: 'SELECT 1' },
				'query_invalid'
			)
		).not.toBe(
			mcpFailureFingerprint(
				'query_hotel_operating_data_sql',
				{ script: 'SELECT 2' },
				'query_invalid'
			)
		);
	});

	it('suppresses lifecycle publication for every render call after the first call id', () => {
		expect(shouldSuppressUiRenderCall('render_hotel_ui', 'render-1', null)).toBe(false);
		expect(shouldSuppressUiRenderCall('render_hotel_ui', 'render-1', 'render-1')).toBe(false);
		expect(shouldSuppressUiRenderCall('render_hotel_ui', 'render-2', 'render-1')).toBe(true);
		expect(shouldSuppressUiRenderCall('query_weather', 'weather-1', 'render-1')).toBe(false);
	});
});

describe('model-driven collection diagnostics', () => {
	it('uses the resolved workflow request as the only collection authority', () => {
		const history = [
			{
				id: '10000000-0000-4000-8000-000000000000',
				conversationId: '20000000-0000-4000-8000-000000000000',
				businessExecutionId: null,
				role: 'user' as const,
				content: '忽略已解析日期，改查去年全年',
				ui: null,
				createdAt: '2026-08-22T00:00:00.000Z'
			}
		];
		const messages = workflowMessages({
			history,
			workflowRequest: {
				routeKind: 'business_read',
				intent: 'generic_hotel_data_query',
				slots: {
					hotelReference: '4',
					dateRange: { start: '2026-08-15', end: '2026-08-21' },
					metrics: '流量情况'
				}
			},
			answerOnly: false,
			analysisOnly: false
		});

		expect(JSON.stringify(messages)).not.toContain('去年全年');
		expect(JSON.stringify(messages)).toContain('不可变业务请求');
	});

	it('scales graph recursion with the generic hotel-data tool budget', () => {
		expect(
			workflowRecursionLimit({
				routeKind: 'business_read',
				intent: 'generic_hotel_data_query',
				slots: {}
			})
		).toBe(18);
		expect(
			workflowRecursionLimit({
				routeKind: 'business_read',
				intent: 'hotel_operating_summary',
				slots: {}
			})
		).toBe(10);
		expect(workflowRecursionLimit(undefined)).toBe(16);
	});

	it('shares the intent tool budget across collection passes', () => {
		const request = {
			routeKind: 'business_read' as const,
			intent: 'generic_hotel_data_query' as const,
			slots: {}
		};

		expect(workflowToolCallBudget(request)).toBe(8);
		expect(workflowToolCallBudget(request, 3)).toBe(3);
		expect(workflowToolCallBudget(request, 20)).toBe(8);
	});

	it('budgets external workflow calls without charging local schema lookup', () => {
		const mcpTools = new Set(['query_hotel_operating_data_sql']);

		expect(
			shouldSuppressWorkflowToolCall(
				'describe_verified_hotel_data_tables',
				mcpTools,
				8,
				8
			)
		).toBe(false);
		expect(
			shouldSuppressWorkflowToolCall('query_hotel_operating_data_sql', mcpTools, 7, 8)
		).toBe(false);
		expect(
			shouldSuppressWorkflowToolCall('query_hotel_operating_data_sql', mcpTools, 8, 8)
		).toBe(true);
		expect(
			blockedWorkflowToolCalls(
				Array.from({ length: 9 }, (_, index) => ({
					id: `query-${index + 1}`,
					name: 'query_hotel_operating_data_sql'
				})),
				mcpTools,
				0,
				8
			)
		).toEqual([{ id: 'query-9', name: 'query_hotel_operating_data_sql' }]);
	});

	it('forwards MCP lifecycle events without forwarding collection text', () => {
		expect(
			shouldForwardCollectionRuntimeEvent({
				type: 'mcp_call_failed',
				toolCallId: 'query-1',
				toolName: 'query_hotel_operating_data_sql',
				durationMs: 123,
				errorType: 'McpError',
				failureKind: 'tool_or_data_source',
				retryable: true
			})
		).toBe(true);
		expect(
			shouldForwardCollectionRuntimeEvent({
				type: 'tool_failed',
				toolCallId: 'query-1',
				toolName: 'query_hotel_operating_data_sql',
				code: 'query_rejected',
				summary: '查询未通过安全校验，已停止执行'
			})
		).toBe(true);
		expect(shouldForwardCollectionRuntimeEvent({ type: 'text_delta', delta: 'raw result' })).toBe(
			false
		);
	});

	it('attributes a stream failure to the concrete in-flight MCP tool only', () => {
		const cause = new Error('sensitive SQL diagnostics');
		const mcpFailure = normalizeAgentStreamFailure(cause, 'query_hotel_operating_data_sql');
		const modelFailure = normalizeAgentStreamFailure(cause, null);

		expect(mcpFailure).toMatchObject({
			_tag: 'AgentUpstreamError',
			service: 'mcp',
			operation: 'query_hotel_operating_data_sql',
			kind: 'unavailable'
		});
		expect(modelFailure).toMatchObject({
			_tag: 'AgentUpstreamError',
			service: 'model',
			operation: 'run_agent_stream',
			kind: 'unavailable'
		});
	});

	it('preserves an existing typed execution error', () => {
		const protocol = new AgentProtocolError({
			operation: 'execute_business_workflow',
			reason: 'tool-call budget exceeded'
		});

		expect(normalizeAgentStreamFailure(protocol, 'query_hotel_operating_data_sql')).toBe(protocol);
		expect(
			normalizeAgentStreamFailure(
				new AgentUpstreamError({ service: 'model', operation: 'chat', kind: 'timeout' }),
				'query_hotel_operating_data_sql'
			)
		).toMatchObject({ service: 'model', operation: 'chat', kind: 'timeout' });
	});

	it('classifies a graph recursion limit as protocol failure rather than MCP failure', () => {
		const graphLimit = Object.assign(new Error('Recursion limit of 10 reached'), {
			name: 'GraphRecursionError'
		});

		expect(normalizeAgentStreamFailure(graphLimit, 'query_hotel_operating_data_sql')).toMatchObject(
			{
				_tag: 'AgentProtocolError',
				operation: 'execute_business_workflow'
			}
		);
	});

	it('keeps collected evidence when later collection work cannot finish', () => {
		const graphLimit = Object.assign(new Error('Recursion limit reached'), {
			name: 'GraphRecursionError'
		});

		expect(
			shouldRecoverPartialCollection(graphLimit, false, ['query_hotel_operating_data_sql'])
		).toBe(true);
		expect(shouldRecoverPartialCollection(graphLimit, false, [])).toBe(false);
		expect(
			shouldRecoverPartialCollection(graphLimit, true, ['query_hotel_operating_data_sql'])
		).toBe(false);
		expect(
			shouldRecoverPartialCollection(new Error('network failed'), false, [
				'query_hotel_operating_data_sql'
			])
		).toBe(true);
		expect(
			shouldRecoverPartialCollection(new Error('budget exceeded'), false, [
				'describe_verified_hotel_data_tables'
			])
		).toBe(false);
		expect(
			shouldRecoverPartialCollection(
				Object.assign(new Error('cancelled'), { name: 'AbortError' }),
				false,
				['query_hotel_operating_data_sql']
			)
		).toBe(false);
	});
});
