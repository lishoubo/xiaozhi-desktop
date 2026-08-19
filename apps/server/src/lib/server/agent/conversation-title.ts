const DEFAULT_CONVERSATION_TITLE = '新对话';
const MAX_CONVERSATION_TITLE_LENGTH = 24;

export function summarizeConversationTitle(prompt: string): string {
	const normalized = prompt.replace(/\s+/gu, ' ').trim();

	const firstClause = normalized.split(/[。！？!?；;\n]/u, 1)[0]?.trim() ?? '';
	const meaningful = firstClause.replace(/^[，,：:\s]+|[，,：:\s]+$/gu, '');
	if (!meaningful) return DEFAULT_CONVERSATION_TITLE;

	const characters = Array.from(meaningful);
	return characters.length <= MAX_CONVERSATION_TITLE_LENGTH
		? meaningful
		: `${characters.slice(0, MAX_CONVERSATION_TITLE_LENGTH).join('')}…`;
}

export function normalizeGeneratedConversationTitle(value: string, fallbackPrompt: string): string {
	const firstLine = value
		.replace(/^[`'“”"]+|[`'“”"]+$/gu, '')
		.split(/\r?\n/u, 1)[0]
		.trim();
	return summarizeConversationTitle(firstLine || fallbackPrompt);
}

export interface ConversationTitleGenerator {
	generate(prompt: string, signal: AbortSignal): Promise<string>;
}
