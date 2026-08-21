import { createHash } from 'node:crypto';

export type McpResultSummary = Readonly<{
	resultType: 'null' | 'string' | 'number' | 'boolean' | 'array' | 'object' | 'other';
	protocolStatus: 'success' | 'error';
	contentBlockCount: number;
	resultCharacterCount: number | null;
	resultFingerprint: string | null;
	filtered: boolean;
}>;

function resultType(value: unknown): McpResultSummary['resultType'] {
	if (value === null) return 'null';
	if (Array.isArray(value)) return 'array';
	if (typeof value === 'string') return 'string';
	if (typeof value === 'number') return 'number';
	if (typeof value === 'boolean') return 'boolean';
	if (typeof value === 'object') return 'object';
	return 'other';
}

function contentBlockCount(value: unknown): number {
	if (typeof value !== 'object' || value === null) return 0;
	const content = Array.isArray(value) ? value : Reflect.get(value, 'content');
	if (!Array.isArray(content)) return 0;
	return content.filter(
		(block) =>
			typeof block === 'object' && block !== null && typeof Reflect.get(block, 'type') === 'string'
	).length;
}

export function mcpResultText(value: unknown): string | null {
	if (typeof value === 'string') return value;
	const content = Array.isArray(value)
		? value
		: typeof value === 'object' && value !== null
			? Reflect.get(value, 'content')
			: null;
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) return null;
	const texts = content.flatMap((block) => {
		if (typeof block !== 'object' || block === null) return [];
		const text = Reflect.get(block, 'text');
		return typeof text === 'string' ? [text] : [];
	});
	return texts.length > 0 ? texts.join('\n') : null;
}

export function mcpResultIsError(value: unknown): boolean {
	if (
		typeof value === 'object' &&
		value !== null &&
		(Reflect.get(value, 'isError') === true || Reflect.get(value, 'status') === 'error')
	) {
		return true;
	}
	const text = mcpResultText(value)?.trim() ?? '';
	return /^(?:ToolException:\s*)?Error calling tool\b/i.test(text);
}

function serializeForSummary(value: unknown): string | null {
	if (typeof value === 'string') return value;
	try {
		const serialized = JSON.stringify(value, (_key, item: unknown) =>
			typeof item === 'bigint' ? item.toString() : item
		);
		return serialized ?? null;
	} catch {
		return null;
	}
}

export function summarizeMcpResult(result: unknown): McpResultSummary {
	const serialized = serializeForSummary(result);
	return {
		resultType: resultType(result),
		protocolStatus: mcpResultIsError(result) ? 'error' : 'success',
		contentBlockCount: contentBlockCount(result),
		resultCharacterCount: serialized?.length ?? null,
		resultFingerprint: serialized ? createHash('sha256').update(serialized).digest('hex') : null,
		filtered: serialized?.includes('[DATA_RESULT_FILTERED]') ?? false
	};
}
