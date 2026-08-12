import { generativeUiSpecSchema } from '@hotel-butler/api';
import type { GenerativeUiSpec } from '@hotel-butler/api';
import { AIMessage, AIMessageChunk, ToolMessage } from '@langchain/core/messages';
import type { BaseMessageLike } from '@langchain/core/messages';
import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { ChatOpenAI } from '@langchain/openai';
import { createAgent, createMiddleware } from 'langchain';
import { z } from 'zod';
import type { AgentRepository } from './agent-repository';
import type { AgentEnvironment } from './agent-config';
import type { AgentRuntime, AgentRuntimeRunOptions } from './agent-runtime';
import type { McpToolProvider } from './mcp-tool-provider';
import { isHotelDataToolName } from './hotel-data-mcp';
import { buildHotelAgentSystemPrompt } from './hotel-agent-prompt';
import { HotelAgentToolHandlers } from './hotel-agent-tool-handlers';
import type { SkillProvider } from './skill-provider';

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
		if (!this.environment.apiKey) throw new Error('AI_KIMI_API_KEY is not configured');
		options.signal.throwIfAborted();

		let generatedUi: GenerativeUiSpec | null = null;
		const [memories, skills] = await Promise.all([
			this.repository.listMemories(options.principal),
			this.skills.list()
		]);
		options.signal.throwIfAborted();
		const localTools = this.createLocalTools(options, (spec) => {
			generatedUi = spec;
		});
		const loadedMcpTools = await this.mcpTools.getTools();
		options.signal.throwIfAborted();
		const tools: StructuredToolInterface[] = [...localTools, ...loadedMcpTools];
		const hotelDataAvailable = loadedMcpTools.some((candidate) =>
			isHotelDataToolName(candidate.name)
		);
		const agent = createAgent({
			model: this.model,
			tools,
			middleware: [singleSuccessfulUiRenderMiddleware(() => generatedUi !== null)],
			systemPrompt: buildHotelAgentSystemPrompt({
				date: new Date().toISOString().slice(0, 10),
				conversationSummary: options.conversationSummary,
				memories,
				skills,
				hotelDataAvailable
			})
		});
		const messages: BaseMessageLike[] = options.history.map((message) => ({
			role: message.role,
			content: message.content
		}));

		let content = '';
		const startedTools = new Set<string>();
		const completedTools = new Set<string>();
		try {
			const stream = await agent.stream(
				{ messages },
				{ streamMode: 'messages', signal: options.signal, recursionLimit: 16 }
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
						startedTools.add(call.id);
						if (call.name === 'render_hotel_ui' && generatedUi) continue;
						await options.emit({
							type: 'tool_started',
							toolCallId: call.id,
							toolName: call.name
						});
					}
					for (const call of message.tool_calls ?? []) {
						if (!call.id || startedTools.has(call.id)) continue;
						startedTools.add(call.id);
						if (call.name === 'render_hotel_ui' && generatedUi) continue;
						await options.emit({
							type: 'tool_started',
							toolCallId: call.id,
							toolName: call.name
						});
					}
					continue;
				}
				if (ToolMessage.isInstance(message)) {
					const callId = message.tool_call_id;
					if (completedTools.has(callId)) continue;
					completedTools.add(callId);
					await options.emit({
						type: 'tool_completed',
						toolCallId: callId,
						toolName: message.name ?? 'tool',
						summary: isHotelDataToolName(message.name ?? '')
							? message.status === 'error'
								? '经营数据查询未成功，正在调整查询条件'
								: '酒店经营数据查询完成'
							: '工具调用已完成'
					});
				}
			}
		} catch (error) {
			const recovered = recoverCompletedUiAfterRenderLimit(error, content, generatedUi);
			if (!recovered) throw error;
			return recovered;
		}
		return { content, ui: generatedUi };
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
				await options.emit({ type: 'ui_spec', spec: validated });
				options.signal.throwIfAborted();
				return '酒店生成式 UI 已发送到前端。';
			},
			{
				name: 'render_hotel_ui',
				description:
					'每次任务最多调用一次。把所需图表、表格和卡片合并到同一个 spec；成功后直接生成最终文字结论，不要再次调用。拿不准图表格式时使用 Table。',
				schema: z.object({ spec: generativeUiSpecSchema })
			}
		);
		return [remember, renderUi];
	}
}
