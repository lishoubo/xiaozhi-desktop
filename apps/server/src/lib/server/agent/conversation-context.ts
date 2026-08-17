import type { AgentMessage, AgentPrincipal } from '@hotel-butler/api';

export type ConversationContextPolicy = Readonly<{
	contextWindowTokens: number;
	triggerTokens: number;
	recentTokenTarget: number;
	minimumRecentMessages: number;
	summaryMaxTokens: number;
}>;

export type StoredConversationContext = Readonly<{
	conversationId: string;
	summary: string | null;
	summarizedThroughMessageId: string | null;
	messages: readonly AgentMessage[];
}>;

type SaveConversationSummaryInput = Readonly<{
	conversationId: string;
	expectedThroughMessageId: string | null;
	summary: string;
	throughMessageId: string;
}>;

export interface ConversationContextRepository {
	getConversationContext(
		principal: AgentPrincipal,
		conversationId: string
	): Promise<StoredConversationContext>;
	saveConversationSummary(
		principal: AgentPrincipal,
		input: SaveConversationSummaryInput
	): Promise<boolean>;
}

type GenerateSummaryInput = Readonly<{
	previousSummary: string | null;
	messages: readonly AgentMessage[];
	maxTokens: number;
	signal?: AbortSignal;
}>;

export interface ConversationSummaryGenerator {
	summarize(input: GenerateSummaryInput): Promise<string>;
}

export type PreparedConversationContext = Readonly<{
	summary: string | null;
	history: readonly AgentMessage[];
}>;

// The configured Moonshot /v1/models endpoint reports a 1M-token context for kimi-k3.
const KIMI_K3_CONTEXT_TOKENS = 1_048_576;

export function contextPolicyForModel(model: string): ConversationContextPolicy {
	const contextWindowTokens = model.toLowerCase() === 'kimi-k3' ? KIMI_K3_CONTEXT_TOKENS : 131_072;
	return {
		contextWindowTokens,
		triggerTokens: Math.floor(contextWindowTokens / 4),
		recentTokenTarget: Math.min(32_768, Math.floor(contextWindowTokens / 16)),
		minimumRecentMessages: 8,
		summaryMaxTokens: 4_096
	};
}

export function estimateConversationTokens(text: string): number {
	let cjkCharacters = 0;
	let otherCharacters = 0;
	for (const character of text) {
		if (
			/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(character)
		) {
			cjkCharacters += 1;
		} else {
			otherCharacters += 1;
		}
	}
	return cjkCharacters + Math.ceil(otherCharacters / 4);
}

function estimateMessageTokens(message: AgentMessage): number {
	return 4 + estimateConversationTokens(message.content);
}

function unsummarizedMessages(context: StoredConversationContext): {
	summary: string | null;
	messages: readonly AgentMessage[];
} {
	if (!context.summarizedThroughMessageId) {
		return { summary: null, messages: context.messages };
	}
	const markerIndex = context.messages.findIndex(
		(message) => message.id === context.summarizedThroughMessageId
	);
	if (markerIndex < 0) return { summary: null, messages: context.messages };
	return { summary: context.summary, messages: context.messages.slice(markerIndex + 1) };
}

export class ConversationContextService {
	constructor(
		private readonly repository: ConversationContextRepository,
		private readonly generator: ConversationSummaryGenerator,
		private readonly policy: ConversationContextPolicy
	) {}

	async prepare(
		principal: AgentPrincipal,
		conversationId: string,
		signal?: AbortSignal
	): Promise<PreparedConversationContext> {
		for (let attempt = 0; attempt < 2; attempt += 1) {
			signal?.throwIfAborted();
			const context = await this.repository.getConversationContext(principal, conversationId);
			signal?.throwIfAborted();
			const pending = unsummarizedMessages(context);
			const estimatedTokens =
				estimateConversationTokens(pending.summary ?? '') +
				pending.messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
			if (estimatedTokens < this.policy.triggerTokens) {
				return { summary: pending.summary, history: pending.messages };
			}

			let splitIndex = pending.messages.length;
			let recentTokens = 0;
			while (
				splitIndex > 0 &&
				(pending.messages.length - splitIndex < this.policy.minimumRecentMessages ||
					recentTokens < this.policy.recentTokenTarget)
			) {
				splitIndex -= 1;
				recentTokens += estimateMessageTokens(pending.messages[splitIndex]);
			}
			const messagesToSummarize = pending.messages.slice(0, splitIndex);
			if (messagesToSummarize.length === 0) {
				return { summary: pending.summary, history: pending.messages };
			}

			const summary = await this.generator.summarize({
				previousSummary: pending.summary,
				messages: messagesToSummarize,
				maxTokens: this.policy.summaryMaxTokens,
				signal
			});
			signal?.throwIfAborted();
			const throughMessageId = messagesToSummarize.at(-1)?.id;
			if (!throughMessageId) return { summary: pending.summary, history: pending.messages };
			const saved = await this.repository.saveConversationSummary(principal, {
				conversationId,
				expectedThroughMessageId: context.summarizedThroughMessageId,
				summary,
				throughMessageId
			});
			if (saved) return { summary, history: pending.messages.slice(splitIndex) };
		}

		signal?.throwIfAborted();
		const latest = unsummarizedMessages(
			await this.repository.getConversationContext(principal, conversationId)
		);
		return { summary: latest.summary, history: latest.messages };
	}
}
