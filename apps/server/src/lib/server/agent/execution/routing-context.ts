import type { AgentMessage } from '@hotel-butler/api';

const CONTINUATION_PROMPT =
	/(?:继续|接着|再(?:查|查询|试|试一次)|重新(?:查|查询|试)|按(?:刚才|之前|上次)|用(?:刚才|之前|上次)|还是(?:刚才|之前|上次)|同样(?:的)?条件|那.{0,20}(?:呢|怎么样|如何)|改成.{0,30}(?:呢|吧)?)/i;
const MAX_CONTEXT_MESSAGES = 8;
const MAX_MESSAGE_CHARACTERS = 2_000;
const MAX_SUMMARY_CHARACTERS = 8_000;
const MAX_MEMORIES = 12;
const MAX_MEMORY_CHARACTERS = 1_000;

type RoutingMemory = Readonly<{ key: string; content: string; importance: number }>;

export function isReferentialContinuation(text: string): boolean {
	return CONTINUATION_PROMPT.test(text.trim());
}

export function buildRoutingContext(
	input: Readonly<{
		prompt: string;
		conversationSummary: string | null;
		history: readonly AgentMessage[];
		currentMessageId: string;
		memories?: readonly RoutingMemory[];
	}>
): string | null {
	const referential = isReferentialContinuation(input.prompt);
	const recentMessages = referential
		? input.history
				.filter((message) => message.id !== input.currentMessageId && message.content.trim())
				.slice(-MAX_CONTEXT_MESSAGES)
				.map((message) => ({
					role: message.role,
					content: message.content.slice(0, MAX_MESSAGE_CHARACTERS)
				}))
		: [];
	const summary = referential
		? (input.conversationSummary?.slice(0, MAX_SUMMARY_CHARACTERS) ?? null)
		: null;
	const memories = (input.memories ?? []).slice(0, MAX_MEMORIES).map((memory) => ({
		key: memory.key,
		content: memory.content.slice(0, MAX_MEMORY_CHARACTERS),
		importance: memory.importance
	}));
	if (!summary && recentMessages.length === 0 && memories.length === 0) return null;
	return JSON.stringify({ summary, recentMessages, memories });
}
