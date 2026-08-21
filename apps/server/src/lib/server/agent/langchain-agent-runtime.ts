import { createHash } from 'node:crypto';
import { generativeUiSpecSchema } from '@hotel-butler/api';
import type { GenerativeUiSpec } from '@hotel-butler/api';
import { AIMessage, AIMessageChunk, ToolMessage } from '@langchain/core/messages';
import type { BaseMessageLike } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { createAgent, createMiddleware } from 'langchain';
import { Effect } from 'effect';
import { z } from 'zod';
import type { AgentRepository } from './agent-repository';
import type { AgentRuntime, AgentRuntimeRunOptions } from './agent-runtime';
import type { McpToolProvider } from './mcp-tool-provider';
import { HOTEL_DATA_SQL_TOOL_NAME, isHotelDataToolName } from './hotel-data-mcp';
import { mcpResultIsError, summarizeMcpResult } from './mcp-observability';
import {
	describeAgentFailure,
	describeToolFailure,
	toolFailureCause,
	toolFailureSummary,
	toolFailureUpstreamKind
} from './agent-failure';
import { buildHotelAgentSystemPrompt } from './hotel-agent-prompt';
import { HotelAgentToolHandlers } from './hotel-agent-tool-handlers';
import type { AgentSkill, SkillProvider } from './skill-provider';
import type { AgentModelGateway } from './model-gateway';
import { getIntentDefinition } from './execution/intent-registry';
import {
	describeVerifiedHotelDataTables,
	HOTEL_DATA_CATALOG_TOOL_NAME,
	verifiedHotelDataTablesForText
} from './hotel-data-business-catalog';
import {
	agentPromise,
	agentErrorCauseType,
	agentErrorType,
	agentFailureKind,
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

type AnalysisCompletionIssue = 'output_limit' | 'empty';

export function analysisCompletionIssue(
	content: string,
	finishReason: string | null
): AnalysisCompletionIssue | null {
	if (finishReason === 'length' || finishReason === 'max_tokens') return 'output_limit';
	return content.trim() ? null : 'empty';
}

class AgentAnalysisIncompleteError extends Error {
	constructor(readonly issue: AnalysisCompletionIssue) {
		super(issue);
		this.name = 'AgentAnalysisIncompleteError';
	}
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

export function shouldCaptureToolEvidence(status: string | undefined, result?: unknown): boolean {
	return status !== 'error' && !mcpResultIsError(result);
}

export function shouldAbortRepeatedMcpFailure(attempts: number): boolean {
	return attempts >= 2;
}

export function mcpFailureFingerprint(
	toolName: string,
	toolArgs: unknown,
	failureCode: string
): string {
	return `${toolName}:${failureCode}:${createHash('sha256')
		.update(JSON.stringify(toolArgs ?? null))
		.digest('hex')}`;
}

export function normalizeAgentStreamFailure(
	error: unknown,
	outstandingMcpToolName: string | null
): unknown {
	if (isAgentExecutionError(error)) return error;
	if (agentErrorType(error) === 'GraphRecursionError') {
		return new AgentProtocolError({
			operation: 'execute_business_workflow',
			reason: 'Agent graph recursion limit reached',
			cause: error
		});
	}
	return new AgentUpstreamError({
		service: outstandingMcpToolName ? 'mcp' : 'model',
		operation: outstandingMcpToolName ?? 'run_agent_stream',
		kind: 'unavailable',
		cause: error
	});
}

export function workflowRecursionLimit(request: AgentRuntimeRunOptions['workflowRequest']): number {
	if (!request) return 16;
	return Math.max(10, getIntentDefinition(request.intent).maxToolCalls * 2 + 2);
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
		return availableNames.filter((name) => name === HOTEL_DATA_SQL_TOOL_NAME);
	}
	if (request.workflowRequest.intent === 'weather_operations_advice') {
		return availableNames.filter((name) =>
			/weather|forecast|temperature|precipitation/i.test(name)
		);
	}
	return availableNames.filter((name) => /rate|price|availability|room/i.test(name));
}

export function shouldLoadMcpTools(
	request: Pick<AgentRuntimeRunOptions, 'allowedMcpCapabilities' | 'validatedEvidence'>
): boolean {
	return request.validatedEvidence === undefined && request.allowedMcpCapabilities.length > 0;
}

export function shouldLoadSkills(
	request: Pick<AgentRuntimeRunOptions, 'allowedSkillNames'>
): boolean {
	return request.allowedSkillNames.length > 0;
}

export function shouldRequireHotelDataQuery(
	request: AgentRuntimeRunOptions['workflowRequest'],
	completedToolNames: readonly string[]
): boolean {
	return hotelDataCollectionToolChoice(request, completedToolNames) !== 'auto';
}

type HotelDataCollectionToolChoice =
	'auto' | 'required' | Readonly<{ type: 'function'; function: Readonly<{ name: string }> }>;

const GENERIC_HOTEL_DATA_SUCCESSFUL_QUERY_LIMIT = 8;
const GENERIC_HOTEL_DATA_QUERY_ROUND_LIMIT = 3;

export function shouldStopHotelDataCollection(
	request: AgentRuntimeRunOptions['workflowRequest'],
	successfulQueryCount: number,
	queryRoundCount = 0
): boolean {
	return (
		request?.intent === 'generic_hotel_data_query' &&
		(successfulQueryCount >= GENERIC_HOTEL_DATA_SUCCESSFUL_QUERY_LIMIT ||
			(successfulQueryCount > 0 && queryRoundCount >= GENERIC_HOTEL_DATA_QUERY_ROUND_LIMIT))
	);
}

export function hotelDataCollectionToolChoice(
	request: AgentRuntimeRunOptions['workflowRequest'],
	completedToolNames: readonly string[]
): HotelDataCollectionToolChoice {
	if (
		request?.intent !== 'generic_hotel_data_query' &&
		request?.intent !== 'hotel_operating_summary'
	) {
		return 'auto';
	}
	if (completedToolNames.includes(HOTEL_DATA_SQL_TOOL_NAME)) return 'auto';
	return {
		type: 'function',
		function: { name: HOTEL_DATA_SQL_TOOL_NAME }
	};
}

export async function loadMcpToolsWithSingleRefresh(
	provider: Pick<McpToolProvider, 'getTools' | 'refreshTools'>,
	capabilities: readonly import('./agent-config').McpCapability[]
): Promise<readonly StructuredToolInterface[]> {
	try {
		return await provider.getTools(capabilities);
	} catch (error) {
		if (!capabilities.includes('hotel_data')) throw error;
		return provider.refreshTools(capabilities);
	}
}

function requireHotelDataQueryMiddleware(request: AgentRuntimeRunOptions['workflowRequest']) {
	return createMiddleware({
		name: 'RequireHotelDataQuery',
		wrapModelCall: (modelRequest, handler) => {
			const completedToolNames = modelRequest.state.messages.flatMap((message) =>
				ToolMessage.isInstance(message) &&
				message.status !== 'error' &&
				!mcpResultIsError(message.content) &&
				message.name
					? [message.name]
					: []
			);
			return handler({
				...modelRequest,
				toolChoice: hotelDataCollectionToolChoice(request, completedToolNames)
			});
		}
	});
}

function stopCompletedHotelDataCollectionMiddleware(
	request: AgentRuntimeRunOptions['workflowRequest']
) {
	return createMiddleware({
		name: 'StopCompletedHotelDataCollection',
		beforeModel: {
			canJumpTo: ['end'],
			hook: (state) => {
				const successfulQueryCount = state.messages.filter(
					(message) =>
						ToolMessage.isInstance(message) &&
						message.name === HOTEL_DATA_SQL_TOOL_NAME &&
						message.status !== 'error' &&
						!mcpResultIsError(message.content)
				).length;
				const queryRoundCount = state.messages.filter(
					(message) =>
						AIMessage.isInstance(message) &&
						message.tool_calls?.some((call) => call.name === HOTEL_DATA_SQL_TOOL_NAME)
				).length;
				return shouldStopHotelDataCollection(request, successfulQueryCount, queryRoundCount)
					? { jumpTo: 'end' as const }
					: undefined;
			}
		}
	});
}

export function isLocalToolAllowed(
	request: Pick<AgentRuntimeRunOptions, 'allowedLocalToolNames'>,
	toolName: AgentRuntimeRunOptions['allowedLocalToolNames'][number]
): boolean {
	return request.allowedLocalToolNames.includes(toolName);
}

export function recoverCompletedUiAfterRenderLimit(
	error: unknown,
	content: string,
	ui: GenerativeUiSpec | null
): Readonly<{ content: string; ui: GenerativeUiSpec }> | null {
	if (!(error instanceof DuplicateUiRenderError) || !ui) return null;
	return completeGroundedAnswerAfterUi(content, ui);
}

export function completeGroundedAnswerAfterUi(
	content: string,
	ui: GenerativeUiSpec
): Readonly<{ content: string; ui: GenerativeUiSpec }> {
	const conclusion = '结果视图已经生成，请结合上方数据查看。';
	return {
		content: content.trim() ? `${content.trimEnd()}\n\n${conclusion}` : conclusion,
		ui
	};
}

export function groundedAnalysisWritingInstructions(): string {
	return `使用专业、易扫读的 Markdown 输出，并按证据充分程度组织以下层次：
## 核心结论
用 1–3 句话先回答最重要的经营判断，优先写清方向、幅度和影响，不写空泛开场。
## 关键发现
列出 2–4 条互不重复的发现；每条先给判断，再紧跟支持该判断的指标、对比或趋势。没有证据的维度不要补齐。
## 经营建议
按优先级给出 1–3 条可执行建议，写清动作、原因和建议观察的指标；不要把常识性口号当建议。
## 数据口径
用简短文字说明酒店/日期范围、数据来源和重要限制。
避免连续大段文字、重复同一结论、深层嵌套列表和无必要表格；单段不超过 3 句。若证据很少，可以合并或省略不适用的小节，但仍须先给结论、后给依据。`;
}

export class LangChainAgentRuntime implements AgentRuntime {
	private readonly localToolHandlers: HotelAgentToolHandlers;
	private readonly model: BaseChatModel;
	private readonly analysisModel: BaseChatModel;

	constructor(
		private readonly modelGateway: AgentModelGateway,
		private readonly repository: AgentRepository,
		private readonly mcpTools: McpToolProvider,
		private readonly skills: SkillProvider
	) {
		this.localToolHandlers = new HotelAgentToolHandlers(repository);
		this.model = modelGateway.createModel('workflow');
		this.analysisModel = modelGateway.createModel('analysis');
	}

	async run(options: AgentRuntimeRunOptions) {
		this.modelGateway.assertConfigured();
		options.signal.throwIfAborted();
		let generatedUi: GenerativeUiSpec | null = null;
		const answerOnly = options.validatedEvidence !== undefined;
		const analysisOnly = answerOnly && options.analysisOnly === true;
		const [memories, availableSkills] = await runAgentEffect(
			Effect.all(
				[
					options.memories
						? Effect.succeed(options.memories)
						: agentPromise({
								service: 'persistence',
								operation: 'load_agent_memories',
								timeoutMs: 10_000,
								try: () => this.repository.listMemories(options.principal)
							}),
					shouldLoadSkills(options)
						? agentPromise({
								service: 'persistence',
								operation: 'load_agent_skills',
								timeoutMs: 10_000,
								try: () => this.skills.list()
							})
						: Effect.succeed<readonly AgentSkill[]>([])
				],
				{ concurrency: 'unbounded' }
			),
			options.signal
		);
		const allowedSkillNames = new Set(options.allowedSkillNames);
		const skills = availableSkills.filter((skill) => allowedSkillNames.has(skill.name));
		options.signal.throwIfAborted();
		const localTools =
			analysisOnly || (options.workflowRequest && !answerOnly)
				? []
				: this.createLocalTools(options, (spec) => {
						if (generatedUi) throw new DuplicateUiRenderError();
						generatedUi = spec;
					});
		const hotelDataCatalogTools: StructuredToolInterface[] =
			options.workflowRequest &&
			!answerOnly &&
			(options.workflowRequest.intent === 'generic_hotel_data_query' ||
				options.workflowRequest.intent === 'hotel_operating_summary')
				? [
						tool(
							({ table_names }) => JSON.stringify(describeVerifiedHotelDataTables(table_names)),
							{
								name: HOTEL_DATA_CATALOG_TOOL_NAME,
								description:
									'读取服务端已验证的 RMS 表字段、粒度、单位、聚合规则、新鲜度和敏感字段；一次提交本轮所需的全部表名，不访问远端。',
								schema: z.object({
									table_names: z.array(z.string().min(1).max(100)).min(1).max(35)
								})
							}
						)
					]
				: [];
		const loadedMcpTools = !shouldLoadMcpTools(options)
			? []
			: await runAgentEffect(
					agentPromise({
						service: 'mcp',
						operation: 'load_runtime_tools',
						timeoutMs: 55_000,
						try: () => loadMcpToolsWithSingleRefresh(this.mcpTools, options.allowedMcpCapabilities)
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
		const tools: StructuredToolInterface[] = [
			...localTools,
			...hotelDataCatalogTools,
			...workflowMcpTools
		];
		const mcpToolNames = new Set(workflowMcpTools.map((tool) => tool.name));
		const workflowToolCallBudget = options.workflowRequest
			? getIntentDefinition(options.workflowRequest.intent).maxToolCalls
			: Number.POSITIVE_INFINITY;
		const hotelDataAvailable = answerOnly
			? (options.validatedEvidence ?? []).some((item) => item.source === 'aliyun_dms_mcp')
			: loadedMcpTools.some((candidate) => isHotelDataToolName(candidate.name));
		const workflowConstraint =
			analysisOnly && options.workflowRequest
				? `\n\n当前是已验证经营数据的分析阶段。不可变请求：${JSON.stringify(options.workflowRequest)}。已验证证据：${JSON.stringify(options.validatedEvidence)}。可靠数据摘要和图表已经展示给用户；不得调用任何工具，不要重复输出原始表格，直接给出简洁、有业务价值的趋势解读、异常提示和可执行建议。不得补造证据中没有的事实，必须说明重要限制。\n\n${groundedAnalysisWritingInstructions()}`
				: answerOnly && options.workflowRequest
					? `\n\n当前是证据校验后的回答阶段。不可变请求：${JSON.stringify(options.workflowRequest)}。已验证证据：${JSON.stringify(options.validatedEvidence)}。不得调用数据工具，不得补造证据中没有的事实；必须写明范围、来源和重要限制。可按需要调用一次 render_hotel_ui。`
					: options.workflowRequest
						? (() => {
								const metrics = options.workflowRequest.slots.metrics;
								const metricText = Array.isArray(metrics)
									? metrics.filter((item): item is string => typeof item === 'string').join(' ')
									: typeof metrics === 'string'
										? metrics
										: '';
								const schemaText =
									metricText ||
									(options.workflowRequest.intent === 'hotel_operating_summary'
										? '经营概览 成交 预约 核销 退款'
										: '');
								const preloadedSchema = verifiedHotelDataTablesForText(schemaText).map((table) => ({
									name: table.name,
									domain: table.domain,
									grain: table.grain,
									timeField: table.timeField,
									freshnessField: table.freshnessField,
									columns: table.columns,
									rules: table.rules
								}));
								return `\n\n当前是受限业务取证阶段。意图：${options.workflowRequest.intent}。已解析参数：${JSON.stringify(options.workflowRequest.slots)}。${options.evidenceGap ? `这是定向补证轮次，只补齐：${options.evidenceGap}` : ''}相关表的已验证字段：${JSON.stringify(preloadedSchema)}。只能使用已提供的只读工具，不得调用、建议或模拟写操作。只完成数据获取，当前阶段文字不会直接展示给用户。database_id 由服务端注入，不要填写或猜测。优先直接并行调用 query_hotel_operating_data_sql；只有相关表未被预载或字段仍不足时，才一次调用 describe_verified_hotel_data_tables 补充，不要调用远端 list/describe。先列出用户明确要求的业务域和指标，再规划完整首批 SQL。每个结果必须返回 hotel_id、实际业务日期范围，并用 latest_data_date 或 latest_fetch_time 证明最新完整数据；分析请求还要返回可比基线。跨表先分别聚合到共同粒度，再按 hotel_id 和必要维度关联。不同 source、单位、快照/事件/日报不得直接混加，汇总行与明细行选择单一层级。禁止查询敏感字段、SELECT * 和原始 JSON。只有证据缺失或失败时才追加，最多 3 个 SQL 规划轮次、累计最多 8 次成功 SQL。数据充分时只回复 DATA_COLLECTION_COMPLETE。`;
							})()
						: '';
		const agent = createAgent({
			model: analysisOnly ? this.analysisModel : this.model,
			tools,
			middleware: [
				stopCompletedHotelDataCollectionMiddleware(
					answerOnly ? undefined : options.workflowRequest
				),
				requireHotelDataQueryMiddleware(answerOnly ? undefined : options.workflowRequest),
				singleSuccessfulUiRenderMiddleware(() => generatedUi !== null)
			],
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
				? [
						{
							role: 'user',
							content: analysisOnly
								? '请分析已验证的经营数据，给出结论和建议。'
								: '请根据已验证证据生成最终答复。'
						}
					]
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
		const mcpFailureCounts = new Map<string, number>();
		const toolEvidence: Array<{ toolName: string; toolArgs: unknown; result: unknown }> = [];
		let completedGroundedUi = false;
		const modelStartedAt = performance.now();
		let firstTokenPublished = false;
		let finishReason: string | null = null;
		try {
			const stream = await agent.stream(
				{ messages },
				{
					streamMode: 'messages',
					signal: options.signal,
					recursionLimit: workflowRecursionLimit(options.workflowRequest)
				}
			);
			for await (const [message] of stream) {
				options.signal.throwIfAborted();
				if (AIMessageChunk.isInstance(message)) {
					const chunkFinishReason = message.response_metadata.finish_reason;
					if (typeof chunkFinishReason === 'string') finishReason = chunkFinishReason;
					const delta = textContent(message.content);
					if (delta) {
						if (!firstTokenPublished) {
							firstTokenPublished = true;
							await options.emit({
								type: 'runtime_phase_completed',
								phase: 'model_first_token',
								durationMs: Math.max(0, Math.round(performance.now() - modelStartedAt))
							});
						}
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
					const failed = message.status === 'error' || mcpResultIsError(message.content);
					const toolFailure = failed ? describeToolFailure(toolName, message.content) : null;
					const failureKey = toolFailure
						? mcpFailureFingerprint(toolName, toolArgs.get(callId) ?? null, toolFailure.code)
						: null;
					const failureCount = failureKey ? (mcpFailureCounts.get(failureKey) ?? 0) + 1 : 0;
					if (failureKey) mcpFailureCounts.set(failureKey, failureCount);
					if (mcpCallStartedAt.has(callId)) {
						const durationMs = Math.max(
							0,
							Math.round(performance.now() - (mcpCallStartedAt.get(callId) ?? performance.now()))
						);
						if (failed) {
							await options.emit({
								type: 'mcp_call_failed',
								toolCallId: callId,
								toolName,
								durationMs,
								errorType: 'McpToolErrorResult',
								failureKind: 'tool_or_data_source',
								retryable: toolFailure?.retryable ?? true
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
					if (shouldCaptureToolEvidence(message.status, message.content)) {
						toolEvidence.push({
							toolName,
							toolArgs: toolArgs.get(callId) ?? null,
							result: message.content
						});
					}
					await options.emit(
						toolFailure
							? {
									type: 'tool_failed',
									toolCallId: callId,
									toolName,
									code: toolFailure.code,
									summary: toolFailureSummary(toolFailure)
								}
							: {
									type: 'tool_completed',
									toolCallId: callId,
									toolName,
									summary: isHotelDataToolName(toolName) ? '酒店经营数据查询完成' : '工具调用已完成'
								}
					);
					if (
						toolFailure &&
						mcpToolNames.has(toolName) &&
						shouldAbortRepeatedMcpFailure(failureCount)
					) {
						const failureCause = toolFailureCause(toolFailure);
						throw new AgentUpstreamError({
							service: 'mcp',
							operation: toolName,
							kind: toolFailureUpstreamKind(toolFailure),
							...(failureCause ? { cause: failureCause } : {})
						});
					}
					if (answerOnly && toolName === 'render_hotel_ui' && generatedUi) {
						completedGroundedUi = true;
						return completeGroundedAnswerAfterUi(content, generatedUi);
					}
				}
			}
		} catch (error) {
			const graphRecursionFailed = agentErrorType(error) === 'GraphRecursionError';
			const outstandingMcpToolName = graphRecursionFailed
				? null
				: ([...mcpCallStartedAt.keys()].flatMap((toolCallId) => {
						if (completedTools.has(toolCallId)) return [];
						return [toolNamesByCall.get(toolCallId) ?? 'mcp_tool'];
					})[0] ?? null);
			const normalizedFailure = normalizeAgentStreamFailure(error, outstandingMcpToolName);
			const failure = describeAgentFailure(normalizedFailure);
			for (const [toolCallId, startedAt] of graphRecursionFailed ? [] : mcpCallStartedAt) {
				if (completedTools.has(toolCallId)) continue;
				const toolName = toolNamesByCall.get(toolCallId) ?? 'mcp_tool';
				await options.emit({
					type: 'mcp_call_failed',
					toolCallId,
					toolName,
					durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
					errorType: agentErrorType(error),
					...(agentErrorCauseType(error) ? { causeType: agentErrorCauseType(error) } : {}),
					failureKind: agentFailureKind(error),
					retryable: failure.retryable
				});
				await options.emit({
					type: 'tool_failed',
					toolCallId,
					toolName,
					code: failure.code,
					summary: toolFailureSummary(failure)
				});
			}
			const recovered =
				completedGroundedUi && generatedUi && !options.signal.aborted
					? completeGroundedAnswerAfterUi(content, generatedUi)
					: recoverCompletedUiAfterRenderLimit(error, content, generatedUi);
			if (!recovered) {
				if (answerOnly && !isAgentExecutionError(error)) {
					throw new AgentUpstreamError({
						service: 'model',
						operation: 'generate_grounded_answer',
						kind: 'unavailable',
						cause: error
					});
				}
				throw normalizedFailure;
			}
			return recovered;
		}
		if (analysisOnly) {
			const issue = analysisCompletionIssue(content, finishReason);
			if (issue) {
				throw new AgentUpstreamError({
					service: 'model',
					operation: 'analyze_grounded_answer',
					kind: 'invalid_response',
					cause: new AgentAnalysisIncompleteError(issue)
				});
			}
		}
		return { content, ui: generatedUi, toolEvidence };
	}

	private createLocalTools(
		options: AgentRuntimeRunOptions,
		setUi: (spec: GenerativeUiSpec) => void
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
		return [
			{ name: 'remember_long_term_memory' as const, tool: remember },
			{ name: 'render_hotel_ui' as const, tool: renderUi }
		]
			.filter((candidate) => isLocalToolAllowed(options, candidate.name))
			.map((candidate) => candidate.tool);
	}
}
