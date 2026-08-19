const DEFAULT_CONVERSATION_TITLE = '新对话';
const MAX_CONVERSATION_TITLE_LENGTH = 24;

const REQUEST_PREFIXES = [
	/^麻烦(?:你)?帮我/u,
	/^请(?:你)?帮我/u,
	/^能不能帮我/u,
	/^可以帮我/u,
	/^帮我/u,
	/^我想(?:要)?/u,
	/^我需要/u
] as const;

export function summarizeConversationTitle(prompt: string): string {
	let normalized = prompt.replace(/\s+/gu, ' ').trim();
	for (const prefix of REQUEST_PREFIXES) {
		normalized = normalized.replace(prefix, '').trim();
	}

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
		?.replace(/^(?:标题|主题)\s*[：:]\s*/u, '')
		.trim();
	return summarizeConversationTitle(firstLine || fallbackPrompt);
}

export interface ConversationTitleGenerator {
	generate(prompt: string, signal: AbortSignal): Promise<string>;
}
