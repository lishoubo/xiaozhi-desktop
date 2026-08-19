import type { AgentMessage } from '@hotel-butler/api';

const MAX_CONTEXT_MESSAGES = 8;
const MAX_MESSAGE_CHARACTERS = 2_000;
const MAX_SUMMARY_CHARACTERS = 8_000;
const MAX_MEMORIES = 12;
const MAX_MEMORY_CHARACTERS = 1_000;

type RoutingMemory = Readonly<{ key: string; content: string; importance: number }>;

export function buildRoutingContext(
	input: Readonly<{
		conversationSummary: string | null;
		history: readonly AgentMessage[];
		currentMessageId: string;
		memories?: readonly RoutingMemory[];
	}>
): string | null {
	const recentMessages = input.history
		.filter((message) => message.id !== input.currentMessageId && message.content.trim())
		.slice(-MAX_CONTEXT_MESSAGES)
		.map((message) => ({
			role: message.role,
			content: message.content.slice(0, MAX_MESSAGE_CHARACTERS)
		}));
	const summary = input.conversationSummary?.slice(0, MAX_SUMMARY_CHARACTERS) ?? null;
	const memories = (input.memories ?? []).slice(0, MAX_MEMORIES).map((memory) => ({
		key: memory.key,
		content: memory.content.slice(0, MAX_MEMORY_CHARACTERS),
		importance: memory.importance
	}));
	if (!summary && recentMessages.length === 0 && memories.length === 0) return null;
	return JSON.stringify({ summary, recentMessages, memories });
}
