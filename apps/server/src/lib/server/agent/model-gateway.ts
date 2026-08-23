import type { ApiLogger } from '@hotel-butler/api/router';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOpenAI } from '@langchain/openai';
import type { AgentEnvironment } from './agent-config';
import { AgentConfigurationError, agentErrorType } from './agent-effect';
import { modelForTier, modelKwargsForTier, type AgentModelTier } from './model-tier';

export type AgentModelPurpose =
	'workflow' | 'analysis' | 'routing' | 'conversation_summary' | 'conversation_title';

export type AgentModelPolicy = Readonly<{
	tier: AgentModelTier;
	maxTokens?: number;
	maxRetries: number;
	timeoutMs: number;
	streaming: boolean;
}>;

export function modelPolicyForPurpose(purpose: AgentModelPurpose): AgentModelPolicy {
	switch (purpose) {
		case 'workflow':
			return { tier: 'fast', maxTokens: 8_192, maxRetries: 1, timeoutMs: 60_000, streaming: true };
		case 'analysis':
			return { tier: 'analysis', maxRetries: 0, timeoutMs: 120_000, streaming: true };
		case 'routing':
			return { tier: 'fast', maxTokens: 1_024, maxRetries: 2, timeoutMs: 30_000, streaming: false };
		case 'conversation_summary':
			return {
				tier: 'fast',
				maxTokens: 4_096,
				maxRetries: 2,
				timeoutMs: 120_000,
				streaming: false
			};
		case 'conversation_title':
			return { tier: 'fast', maxTokens: 40, maxRetries: 1, timeoutMs: 20_000, streaming: false };
	}
}

export interface AgentModelGateway {
	readonly configured: boolean;
	assertConfigured(): void;
	createModel(
		purpose: AgentModelPurpose,
		options?: Readonly<{ maxTokens?: number }>
	): BaseChatModel;
}

export class ModelInvocationTelemetry {
	private readonly startedAt = new Map<string, number>();

	constructor(
		private readonly logger: ApiLogger,
		private readonly fields: Readonly<{
			purpose: AgentModelPurpose;
			tier: AgentModelTier;
			model: string;
		}>,
		private readonly now: () => number = () => performance.now()
	) {}

	start(runId: string, parentRunId?: string): void {
		this.startedAt.set(runId, this.now());
		this.logger.info(
			{
				event: 'agent.model_call_started',
				modelRunId: runId,
				...(parentRunId ? { parentModelRunId: parentRunId } : {}),
				...this.fields
			},
			'Agent model call started'
		);
	}

	complete(runId: string, parentRunId?: string): void {
		this.logger.info(
			{
				event: 'agent.model_call_completed',
				modelRunId: runId,
				...(parentRunId ? { parentModelRunId: parentRunId } : {}),
				durationMs: this.duration(runId),
				...this.fields
			},
			'Agent model call completed'
		);
	}

	fail(error: unknown, runId: string, parentRunId?: string): void {
		this.logger.error(
			{
				event: 'agent.model_call_failed',
				modelRunId: runId,
				...(parentRunId ? { parentModelRunId: parentRunId } : {}),
				durationMs: this.duration(runId),
				errorType: agentErrorType(error),
				...this.fields
			},
			'Agent model call failed'
		);
	}

	private duration(runId: string): number {
		const startedAt = this.startedAt.get(runId);
		this.startedAt.delete(runId);
		return startedAt === undefined ? 0 : Math.max(0, Math.round(this.now() - startedAt));
	}
}

class ModelLifecycleCallback extends BaseCallbackHandler {
	readonly name = 'HotelButlerModelLifecycle';

	constructor(private readonly telemetry: ModelInvocationTelemetry) {
		super();
	}

	override handleLLMStart(
		_llm: unknown,
		_prompts: string[],
		runId: string,
		parentRunId?: string
	): void {
		this.telemetry.start(runId, parentRunId);
	}

	override handleChatModelStart(
		_llm: unknown,
		_messages: unknown,
		runId: string,
		parentRunId?: string
	): void {
		this.telemetry.start(runId, parentRunId);
	}

	override handleLLMEnd(_output: unknown, runId: string, parentRunId?: string): void {
		this.telemetry.complete(runId, parentRunId);
	}

	override handleLLMError(error: unknown, runId: string, parentRunId?: string): void {
		this.telemetry.fail(error, runId, parentRunId);
	}
}

export class LangChainModelGateway implements AgentModelGateway {
	readonly configured: boolean;

	constructor(
		private readonly environment: AgentEnvironment,
		private readonly logger: ApiLogger
	) {
		this.configured = Boolean(environment.apiKey);
	}

	assertConfigured(): void {
		if (!this.configured) throw new AgentConfigurationError({ setting: 'AI_KIMI_API_KEY' });
	}

	createModel(
		purpose: AgentModelPurpose,
		options: Readonly<{ maxTokens?: number }> = {}
	): BaseChatModel {
		const policy = modelPolicyForPurpose(purpose);
		const model = modelForTier(this.environment, policy.tier);
		const requestedMaxTokens = options.maxTokens;
		const maxTokens =
			requestedMaxTokens === undefined
				? policy.maxTokens
				: policy.maxTokens === undefined
					? requestedMaxTokens
					: Math.min(requestedMaxTokens, policy.maxTokens);
		const telemetry = new ModelInvocationTelemetry(this.logger, {
			purpose,
			tier: policy.tier,
			model
		});

		return new ChatOpenAI({
			model,
			apiKey: this.environment.apiKey,
			modelKwargs: modelKwargsForTier(model, policy.tier),
			...(maxTokens === undefined ? {} : { maxTokens }),
			streaming: policy.streaming,
			maxRetries: policy.maxRetries,
			timeout: policy.timeoutMs,
			callbacks: [new ModelLifecycleCallback(telemetry)],
			configuration: { baseURL: this.environment.baseUrl }
		});
	}
}
