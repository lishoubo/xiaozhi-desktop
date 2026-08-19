import type { GenerativeUiSpec } from '@hotel-butler/api';
import { describe, expect, it } from 'vitest';
import {
	analysisCompletionIssue,
	DuplicateUiRenderError,
	completeGroundedAnswerAfterUi,
	groundedAnalysisWritingInstructions,
	isLocalToolAllowed,
	normalizeAgentStreamFailure,
	recoverCompletedUiAfterRenderLimit,
	selectWorkflowToolNames,
	shouldLoadMcpTools,
	shouldLoadSkills,
	shouldCaptureToolEvidence,
	shouldSuppressUiRenderCall,
	shouldStopDuplicateUiRender,
	workflowRecursionLimit
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
	});
});

describe('selectWorkflowToolNames', () => {
	const available = [
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

describe('tool evidence capture', () => {
	it('does not treat an error ToolMessage as business evidence', () => {
		expect(shouldCaptureToolEvidence('error')).toBe(false);
		expect(shouldCaptureToolEvidence('success')).toBe(true);
		expect(shouldCaptureToolEvidence(undefined)).toBe(true);
	});

	it('suppresses lifecycle publication for every render call after the first call id', () => {
		expect(shouldSuppressUiRenderCall('render_hotel_ui', 'render-1', null)).toBe(false);
		expect(shouldSuppressUiRenderCall('render_hotel_ui', 'render-1', 'render-1')).toBe(false);
		expect(shouldSuppressUiRenderCall('render_hotel_ui', 'render-2', 'render-1')).toBe(true);
		expect(shouldSuppressUiRenderCall('query_weather', 'weather-1', 'render-1')).toBe(false);
	});
});

describe('model-driven collection diagnostics', () => {
	it('scales graph recursion with the generic hotel-data tool budget', () => {
		expect(
			workflowRecursionLimit({
				routeKind: 'business_read',
				intent: 'generic_hotel_data_query',
				slots: {}
			})
		).toBe(32);
		expect(
			workflowRecursionLimit({
				routeKind: 'business_read',
				intent: 'hotel_operating_summary',
				slots: {}
			})
		).toBe(10);
		expect(workflowRecursionLimit(undefined)).toBe(16);
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
});
