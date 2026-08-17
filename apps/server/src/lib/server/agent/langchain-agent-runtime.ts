import { generativeUiSpecSchema } from '@hotel-butler/api';
import type { GenerativeUiSpec } from '@hotel-butler/api';
import { AIMessage, AIMessageChunk, ToolMessage } from '@langchain/core/messages';
import type { BaseMessageLike } from '@langchain/core/messages';
import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { ChatOpenAI } from '@langchain/openai';
import { createAgent, createMiddleware } from 'langchain';
import { Effect } from 'effect';
import { z } from 'zod';
import type { AgentRepository } from './agent-repository';
import type { AgentEnvironment } from './agent-config';
import type { AgentRuntime, AgentRuntimeRunOptions } from './agent-runtime';
import type { McpToolProvider } from './mcp-tool-provider';
import { isHotelDataToolName } from './hotel-data-mcp';
import { summarizeMcpResult } from './mcp-observability';
import { buildHotelAgentSystemPrompt } from './hotel-agent-prompt';
import { HotelAgentToolHandlers } from './hotel-agent-tool-handlers';
import type { SkillProvider } from './skill-provider';
import { getIntentDefinition } from './execution/intent-registry';
import {
	agentPromise,
	agentErrorRetryable,
	agentErrorType,
	agentFailureKind,
	AgentConfigurationError,
	AgentProtocolError,
	AgentUpstreamError,
	isAgentExecutionError,
	runAgentEffect
} from './agent-effect';

function textContent(value: unknown): string {
	if (typeof value === 'string') return value;
	if (!Array.isArray(value)) return '';
	return value
		.map((part) => {
			if (typeof part === 'string') return part;
			if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
				return part.text;
			}
			return '';
		})
		.join('');
}

export class DuplicateUiRenderError extends Error {
	constructor() {
		super('A valid generated UI has already been emitted for this Run');
		this.name = 'DuplicateUiRenderError';
	}
}

export function shouldStopDuplicateUiRender(
	hasGeneratedUi: boolean,
	toolNames: readonly string[]
): boolean {
	return hasGeneratedUi && toolNames.includes('render_hotel_ui');
}

export function shouldCaptureToolEvidence(status: string | undefined): boolean {
	return status !== 'error';
}

export function shouldSuppressUiRenderCall(
	toolName: string,
	toolCallId: string,
	firstUiRenderCallId: string | null
): boolean {
	return (
		toolName === 'render_hotel_ui' &&
		firstUiRenderCallId !== null &&
		firstUiRenderCallId !== toolCallId
	);
}

function singleSuccessfulUiRenderMiddleware(hasGeneratedUi: () => boolean) {
	return createMiddleware({
		name: 'SingleSuccessfulUiRender',
		afterModel: (state) => {
			const lastAiMessage = [...state.messages].reverse().find(AIMessage.isInstance);
			if (
				shouldStopDuplicateUiRender(
					hasGeneratedUi(),
					lastAiMessage?.tool_calls?.map((call) => call.name) ?? []
				)
			) {
				throw new DuplicateUiRenderError();
			}
		}
	});
}

export function selectWorkflowToolNames(
	request: Pick<AgentRuntimeRunOptions, 'workflowRequest' | 'validatedEvidence'>,
	availableNames: readonly string[]
): readonly string[] {
	if (!request.workflowRequest) return availableNames;
	if (request.validatedEvidence !== undefined) return ['render_hotel_ui'];
	if (
		request.workflowRequest.intent === 'hotel_operating_summary' ||
		request.workflowRequest.intent === 'generic_hotel_data_query'
	) {
		return availableNames.filter(isHotelDataToolName);
	}
	if (request.workflowRequest.intent === 'weather_operations_advice') {
		return availableNames.filter((name) =>
			/weather|forecast|temperature|precipitation/i.test(name)
		);
	}
	return availableNames.filter((name) => /rate|price|availability|room/i.test(name));
}

export function recoverCompletedUiAfterRenderLimit(
	error: unknown,
	content: string,
	ui: GenerativeUiSpec | null
): Readonly<{ content: string; ui: GenerativeUiSpec }> | null {
	if (!(error instanceof DuplicateUiRenderError) || !ui) return null;
	const conclusion = '结果视图已经生成，请结合上方数据查看。';
	return {
		content: content.trim() ? `${content.trimEnd()}\n\n${conclusion}` : conclusion,
		ui
	};
}

export class LangChainAgentRuntime implements AgentRuntime {
	private readonly localToolHandlers: HotelAgentToolHandlers;
	private readonly model: ChatOpenAI;

	constructor(
		private readonly environment: AgentEnvironment,
		private readonly repository: AgentRepository,
		private readonly mcpTools: McpToolProvider,
		private readonly skills: SkillProvider
	) {
		this.localToolHandlers = new HotelAgentToolHandlers(repository);
		this.model = new ChatOpenAI({
			model: this.environment.model,
			apiKey: this.environment.apiKey,
			streaming: true,
			maxTokens: 8192,
			maxRetries: 2,
			timeout: 120_000,
			configuration: { baseURL: this.environment.baseUrl }
		});
	}

	async run(options: AgentRuntimeRunOptions) {
		if (!this.environment.apiKey) {
			throw new AgentConfigurationError({ setting: 'AI_KIMI_API_KEY' });
		}
		options.signal.throwIfAborted();
		let generatedUi: GenerativeUiSpec | null = null;
		const answerOnly = options.validatedEvidence !== undefined;
		const [memories, skills] = answerOnly
			? [[], []]
			: await runAgentEffect(
					Effect.all(
						[
							agentPromise({
								service: 'persistence',
								operation: 'load_agent_memories',
								timeoutMs: 10_000,
								try: () => this.repository.listMemories(options.principal)
							}),
							agentPromise({
								service: 'persistence',
								operation: 'load_agent_skills',
								timeoutMs: 10_000,
								try: () => this.skills.list()
							})
						],
						{ concurrency: 'unbounded' }
					),
					options.signal
				);
		options.signal.throwIfAborted();
		const localTools =
			options.workflowRequest && !answerOnly
				? []
				: this.createLocalTools(
						options,
						(spec) => {
							if (generatedUi) throw new DuplicateUiRenderError();
							generatedUi = spec;
						},
						!answerOnly
					);
		const loadedMcpTools = answerOnly
			? []
			: await runAgentEffect(
					agentPromise({
						service: 'mcp',
						operation: 'load_runtime_tools',
						timeoutMs: 55_000,
						try: () => this.mcpTools.getTools()
					}),
					options.signal
				);
		options.signal.throwIfAborted();
		const workflowMcpTools =
			options.workflowRequest && !answerOnly
				? loadedMcpTools.filter((candidate) =>
						selectWorkflowToolNames(
							options,
							loadedMcpTools.map((tool) => tool.name)
						).includes(candidate.name)
					)
				: loadedMcpTools;
		const tools: StructuredToolInterface[] = [...localTools, ...workflowMcpTools];
		const mcpToolNames = new Set(workflowMcpTools.map((tool) => tool.name));
		const workflowToolCallBudget = options.workflowRequest
			? getIntentDefinition(options.workflowRequest.intent).maxToolCalls
			: Number.POSITIVE_INFINITY;
		const hotelDataAvailable = answerOnly
			? (options.validatedEvidence ?? []).some((item) => item.source === 'aliyun_dms_mcp')
			: loadedMcpTools.some((candidate) => isHotelDataToolName(candidate.name));
		const workflowConstraint =
			answerOnly && options.workflowRequest
				? `\n\n当前是证据校验后的回答阶段。不可变请求：${JSON.stringify(options.workflowRequest)}。已验证证据：${JSON.stringify(options.validatedEvidence)}。不得调用数据工具，不得补造证据中没有的事实；必须写明范围、来源和重要限制。可按需要调用一次 render_hotel_ui。`
				: options.workflowRequest
					? `\n\n当前是受限业务取证阶段。意图：${options.workflowRequest.intent}。已解析参数：${JSON.stringify(options.workflowRequest.slots)}。只能使用已提供的只读工具，不得调用、建议或模拟任何写操作。只完成数据获取，最终文字不会直接展示给用户。仅检查回答所必需的表结构，避免重复描述同一张表；generate_hotel_operating_data_sql 只生成 SQL、不是数据证据，调用后必须继续调用 query_hotel_operating_data_sql 执行。`
					: '';
		const agent = createAgent({
			model: this.model,
			tools,
			middleware: [singleSuccessfulUiRenderMiddleware(() => generatedUi !== null)],
			systemPrompt: `${buildHotelAgentSystemPrompt({
				date: new Date().toISOString().slice(0, 10),
				conversationSummary: options.conversationSummary,
				memories,
				skills,
				hotelDataAvailable
			})}${workflowConstraint}`
		});
		const messages: BaseMessageLike[] =
			answerOnly && options.workflowRequest
				? [{ role: 'user', content: '请根据已验证证据生成最终答复。' }]
				: options.history.map((message) => ({
						role: message.role,
						content: message.content
					}));

		let content = '';
		const startedTools = new Set<string>();
		const suppressedTools = new Set<string>();
		let firstUiRenderCallId: string | null = null;
		let startedWorkflowToolCount = 0;
		const completedTools = new Set<string>();
		const toolArgs = new Map<string, unknown>();
		const toolNamesByCall = new Map<string, string>();
		const mcpCallStartedAt = new Map<string, number>();
		const toolEvidence: Array<{ toolName: string; toolArgs: unknown; result: unknown }> = [];
		try {
			const stream = await agent.stream(
				{ messages },
				{
					streamMode: 'messages',
					signal: options.signal,
					recursionLimit: options.workflowRequest ? 10 : 16
				}
			);
			for await (const [message] of stream) {
				options.signal.throwIfAborted();
				if (AIMessageChunk.isInstance(message)) {
					const delta = textContent(message.content);
					if (delta) {
						content += delta;
						await options.emit({ type: 'text_delta', delta });
					}
					for (const call of message.tool_call_chunks ?? []) {
						if (!call.id || !call.name || startedTools.has(call.id)) continue;
						if (shouldSuppressUiRenderCall(call.name, call.id, firstUiRenderCallId)) {
							startedTools.add(call.id);
							suppressedTools.add(call.id);
							continue;
						}
						if (call.name === 'render_hotel_ui') firstUiRenderCallId = call.id;
						if (
							call.name !== 'render_hotel_ui' &&
							startedWorkflowToolCount >= workflowToolCallBudget
						) {
							throw new AgentProtocolError({
								operation: 'execute_business_workflow',
								reason: 'Business workflow tool-call budget exceeded'
							});
						}
						if (call.name !== 'render_hotel_ui') startedWorkflowToolCount += 1;
						startedTools.add(call.id);
						if (call.name === 'render_hotel_ui' && generatedUi) continue;
						await options.emit({
							type: 'tool_started',
							toolCallId: call.id,
							toolName: call.name
						});
						toolNamesByCall.set(call.id, call.name);
						if (mcpToolNames.has(call.name)) {
							mcpCallStartedAt.set(call.id, performance.now());
							await options.emit({
								type: 'mcp_call_started',
								toolCallId: call.id,
								toolName: call.name
							});
						}
					}
					for (const call of message.tool_calls ?? []) {
						if (!call.id) continue;
						toolArgs.set(call.id, call.args);
						if (startedTools.has(call.id)) continue;
						if (shouldSuppressUiRenderCall(call.name, call.id, firstUiRenderCallId)) {
							startedTools.add(call.id);
							suppressedTools.add(call.id);
							continue;
						}
						if (call.name === 'render_hotel_ui') firstUiRenderCallId = call.id;
						if (
							call.name !== 'render_hotel_ui' &&
							startedWorkflowToolCount >= workflowToolCallBudget
						) {
							throw new AgentProtocolError({
								operation: 'execute_business_workflow',
								reason: 'Business workflow tool-call budget exceeded'
							});
						}
						if (call.name !== 'render_hotel_ui') startedWorkflowToolCount += 1;
						startedTools.add(call.id);
						if (call.name === 'render_hotel_ui' && generatedUi) continue;
						await options.emit({
							type: 'tool_started',
							toolCallId: call.id,
							toolName: call.name
						});
						toolNamesByCall.set(call.id, call.name);
						if (mcpToolNames.has(call.name)) {
							mcpCallStartedAt.set(call.id, performance.now());
							await options.emit({
								type: 'mcp_call_started',
								toolCallId: call.id,
								toolName: call.name
							});
						}
					}
					continue;
				}
				if (ToolMessage.isInstance(message)) {
					const callId = message.tool_call_id;
					if (suppressedTools.has(callId)) continue;
					if (completedTools.has(callId)) continue;
					completedTools.add(callId);
					const toolName = message.name ?? toolNamesByCall.get(callId) ?? 'tool';
					if (mcpCallStartedAt.has(callId)) {
						const durationMs = Math.max(
							0,
							Math.round(performance.now() - (mcpCallStartedAt.get(callId) ?? performance.now()))
						);
						if (message.status === 'error') {
							await options.emit({
								type: 'mcp_call_failed',
								toolCallId: callId,
								toolName,
								durationMs,
								errorType: 'McpToolErrorResult',
								failureKind: 'tool_or_data_source',
								retryable: true
							});
						} else {
							await options.emit({
								type: 'mcp_call_completed',
								toolCallId: callId,
								toolName,
								durationMs,
								resultSummary: summarizeMcpResult(message.content)
							});
						}
					}
					if (shouldCaptureToolEvidence(message.status)) {
						toolEvidence.push({
							toolName,
							toolArgs: toolArgs.get(callId) ?? null,
							result: message.content
						});
					}
					await options.emit({
						type: 'tool_completed',
						toolCallId: callId,
						toolName,
						summary: isHotelDataToolName(toolName)
							? message.status === 'error'
								? '经营数据查询未成功，正在调整查询条件'
								: '酒店经营数据查询完成'
							: '工具调用已完成'
					});
				}
			}
		} catch (error) {
			for (const [toolCallId, startedAt] of mcpCallStartedAt) {
				if (completedTools.has(toolCallId)) continue;
				await options.emit({
					type: 'mcp_call_failed',
					toolCallId,
					toolName: toolNamesByCall.get(toolCallId) ?? 'mcp_tool',
					durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
					errorType: agentErrorType(error),
					failureKind: agentFailureKind(error),
					retryable: agentErrorRetryable(error)
				});
			}
			const recovered = recoverCompletedUiAfterRenderLimit(error, content, generatedUi);
			if (!recovered) {
				if (isAgentExecutionError(error)) throw error;
				throw new AgentUpstreamError({
					service: answerOnly ? 'model' : options.workflowRequest ? 'mcp' : 'model',
					operation: answerOnly ? 'generate_grounded_answer' : 'run_agent_stream',
					kind: 'unavailable',
					cause: error
				});
			}
			return recovered;
		}
		return { content, ui: generatedUi, toolEvidence };
	}

	private createLocalTools(
		options: AgentRuntimeRunOptions,
		setUi: (spec: GenerativeUiSpec) => void,
		allowMemoryWrite: boolean
	): StructuredToolInterface[] {
		const remember = tool(
			async ({ key, content, importance }) => {
				options.signal.throwIfAborted();
				const result = await this.localToolHandlers.remember(options.principal, {
					key,
					content,
					importance
				});
				options.signal.throwIfAborted();
				return result;
			},
			{
				name: 'remember_long_term_memory',
				description: '仅在用户明确表达稳定偏好或要求记住长期事实时保存。不要保存敏感凭证。',
				schema: z.object({
					key: z.string().regex(/^[a-z0-9_.-]{1,80}$/),
					content: z.string().min(1).max(2_000),
					importance: z.number().int().min(1).max(5).default(1)
				})
			}
		);
		const renderUi = tool(
			async ({ spec }) => {
				options.signal.throwIfAborted();
				const validated = this.localToolHandlers.renderUi(spec);
				setUi(validated);
				options.signal.throwIfAborted();
				return '酒店结果视图已通过校验，将随最终答复一起展示。';
			},
			{
				name: 'render_hotel_ui',
				description:
					'每次任务最多调用一次。把所需图表、表格和卡片合并到同一个 spec；成功后直接生成最终文字结论，不要再次调用。拿不准图表格式时使用 Table。',
				schema: z.object({ spec: generativeUiSpecSchema })
			}
		);
		return allowMemoryWrite ? [remember, renderUi] : [renderUi];
	}
}
