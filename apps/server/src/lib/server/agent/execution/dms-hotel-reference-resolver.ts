import type { DynamicStructuredTool } from '@langchain/core/tools';
import { HOTEL_DATA_SQL_TOOL_NAME } from '../hotel-data-mcp';
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

function extractHotelIds(value: unknown): readonly string[] {
	const text: string[] = [];
	collectText(value, text);
	const ids = new Set<string>();
	for (const content of text) {
		for (const line of content.split(/\r?\n/)) {
			const match = /^\|\s*(\d+)\s*\|$/.exec(line.trim());
			if (match?.[1]) ids.add(match[1]);
		}
	}
	return [...ids].slice(0, 10);
}

export class DmsHotelReferenceResolver implements HotelReferenceResolver {
	constructor(private readonly tools: McpToolsPort) {}

	async resolve(
		...input: readonly [reference: string, orgId: string]
	): Promise<readonly HotelCandidate[]> {
		void input;
		const queryTool = (await this.tools.getTools()).find(
			(tool) => tool.name === HOTEL_DATA_SQL_TOOL_NAME
		);
		if (!queryTool) return [];
		const result = await queryTool.invoke({
			database_id: 'server-configured',
			script:
				'SELECT DISTINCT hotel_id FROM fact_business_daily WHERE hotel_id IS NOT NULL ORDER BY hotel_id LIMIT 10'
		});
		return extractHotelIds(result).map((id) => ({
			id,
			label: `酒店 ID ${id}`,
			match: 'fuzzy' as const,
			accessScope: 'shared_dms_token' as const
		}));
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
