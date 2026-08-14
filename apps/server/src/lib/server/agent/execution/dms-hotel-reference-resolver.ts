import type { DynamicStructuredTool } from '@langchain/core/tools';
import { HOTEL_DATA_SQL_TOOL_NAME } from '../hotel-data-mcp';
import { agentPromise, runAgentEffect } from '../agent-effect';
import type { HotelCandidate, HotelReferenceResolver } from './slot-resolver';

type McpToolsPort = Readonly<{ getTools(): Promise<readonly DynamicStructuredTool[]> }>;

function collectText(value: unknown, output: string[], depth = 0): void {
	if (depth > 8) return;
	if (typeof value === 'string') {
		output.push(value);
		try {
			collectText(JSON.parse(value), output, depth + 1);
		} catch {
			// Ordinary MCP text content does not need another parsing pass.
		}
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) collectText(item, output, depth + 1);
		return;
	}
	if (typeof value !== 'object' || value === null) return;
	for (const item of Object.values(value)) collectText(item, output, depth + 1);
}

type HotelNameRow = Readonly<{ id: string; name: string }>;

function normalizedHotelName(value: string): string {
	return value
		.normalize('NFKC')
		.trim()
		.toLocaleLowerCase('zh-CN')
		.replace(/[\s·・_—\-()[\]{}（）【】]/g, '');
}

function extractHotelNames(value: unknown): readonly HotelNameRow[] {
	const text: string[] = [];
	collectText(value, text);
	const rows = new Map<string, HotelNameRow>();
	for (const content of text) {
		for (const line of content.split(/\r?\n/)) {
			const match = /^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|$/.exec(line.trim());
			const id = match?.[1];
			const name = match?.[2]?.trim();
			if (id && name && name !== '---') rows.set(`${id}\u0000${name}`, { id, name });
		}
	}
	return [...rows.values()];
}

function matchHotelNames(rows: readonly HotelNameRow[], reference: string): readonly HotelCandidate[] {
	const target = normalizedHotelName(reference);
	if (!target) return [];
	const byId = new Map<string, HotelNameRow[]>();
	for (const row of rows) byId.set(row.id, [...(byId.get(row.id) ?? []), row]);

	const candidates: HotelCandidate[] = [];
	for (const [id, aliases] of byId) {
		const exact = aliases.find((row) => normalizedHotelName(row.name) === target);
		const partial = aliases.find((row) => {
			const name = normalizedHotelName(row.name);
			return name.includes(target) || target.includes(name);
		});
		const matched = exact ?? partial;
		if (!matched) continue;
		candidates.push({
			id,
			label: matched.name,
			match: exact ? 'exact' : 'alias',
			accessScope: 'shared_dms_token'
		});
	}
	return candidates.slice(0, 10);
}

export class DmsHotelReferenceResolver implements HotelReferenceResolver {
	constructor(private readonly tools: McpToolsPort) {}

	async resolve(
		...input: readonly [reference: string, orgId: string]
	): Promise<readonly HotelCandidate[]> {
		const [reference] = input;
		const queryTool = (await this.tools.getTools()).find(
			(tool) => tool.name === HOTEL_DATA_SQL_TOOL_NAME
		);
		if (!queryTool) return [];
		const result = await runAgentEffect(
			agentPromise({
				service: 'mcp',
				operation: 'resolve_hotel_reference',
				timeoutMs: 50_000,
				try: (signal) =>
					queryTool.invoke(
						{
							database_id: 'server-configured',
							script:
								"SELECT DISTINCT hotel_id, ota_hotel_name FROM ota_order WHERE ota_hotel_name IS NOT NULL AND ota_hotel_name <> '' ORDER BY hotel_id, ota_hotel_name LIMIT 50"
						},
						{ signal }
					)
			})
		);
		return matchHotelNames(extractHotelNames(result), reference);
	}
}

export class FallbackHotelReferenceResolver implements HotelReferenceResolver {
	constructor(
		private readonly primary: HotelReferenceResolver,
		private readonly fallback: HotelReferenceResolver
	) {}

	async resolve(reference: string, orgId: string): Promise<readonly HotelCandidate[]> {
		const candidates = await this.primary.resolve(reference, orgId);
		return candidates.length > 0 ? candidates : this.fallback.resolve(reference, orgId);
	}
}
