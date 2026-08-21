import { Buffer } from 'node:buffer';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import { HOTEL_DATA_SQL_TOOL_NAME } from '../hotel-data-mcp';
import { agentPromise, runAgentEffect } from '../agent-effect';
import type { HotelCandidate, HotelReferenceResolver } from './slot-resolver';

type McpToolsPort = Readonly<{
	getTools(capabilities: readonly ['hotel_data']): Promise<readonly DynamicStructuredTool[]>;
}>;

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

function scalarText(value: unknown): string | null {
	if (typeof value === 'string') return value.trim() || null;
	if (typeof value === 'number' && Number.isFinite(value)) return String(value);
	return null;
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function structuredHotelNameRows(
	value: unknown,
	output: Map<string, HotelNameRow>,
	depth = 0
): void {
	if (depth > 8) return;
	if (typeof value === 'string') {
		try {
			structuredHotelNameRows(JSON.parse(value), output, depth + 1);
		} catch {
			// Ordinary MCP text is parsed separately as a Markdown table.
		}
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) structuredHotelNameRows(item, output, depth + 1);
		return;
	}
	if (!isUnknownRecord(value)) return;

	const directId = scalarText(value.hotel_id);
	const directName = scalarText(value.ota_hotel_name);
	if (directId && directName)
		output.set(`${directId}\u0000${directName}`, { id: directId, name: directName });

	const columnsValue = value.columns ?? value.columnNames ?? value.column_names;
	const rowsValue = value.rows ?? value.data;
	if (Array.isArray(columnsValue) && Array.isArray(rowsValue)) {
		const columns = columnsValue.map(scalarText);
		const idIndex = columns.indexOf('hotel_id');
		const nameIndex = columns.indexOf('ota_hotel_name');
		if (idIndex >= 0 && nameIndex >= 0) {
			for (const row of rowsValue) {
				if (!Array.isArray(row)) continue;
				const id = scalarText(row[idIndex]);
				const name = scalarText(row[nameIndex]);
				if (id && name) output.set(`${id}\u0000${name}`, { id, name });
			}
		}
	}
	for (const item of Object.values(value)) structuredHotelNameRows(item, output, depth + 1);
}

function normalizedHotelName(value: string): string {
	return value
		.normalize('NFKC')
		.trim()
		.toLocaleLowerCase('zh-CN')
		.replace(/[\s·・_—\-()[\]{}（）【】]/g, '');
}

export function hotelDirectoryQuery(reference: string): string | null {
	const fragments = reference
		.normalize('NFKC')
		.toLocaleLowerCase('zh-CN')
		.split(/[\s·・_—\-()[\]{}【】'";]+/)
		.map((fragment) => fragment.trim())
		.filter(Boolean)
		.slice(0, 6);
	if (fragments.length === 0) return null;
	const predicates = fragments.map((fragment) => {
		const fragmentHex = Buffer.from(fragment, 'utf8').toString('hex');
		return `LOWER(ota_hotel_name) LIKE CONCAT('%', CONVERT(0x${fragmentHex} USING utf8mb4) COLLATE utf8mb4_unicode_ci, '%')`;
	});
	return `SELECT DISTINCT hotel_id, ota_hotel_name FROM ota_order WHERE ota_hotel_name IS NOT NULL AND ${predicates.join(' AND ')} ORDER BY hotel_id, ota_hotel_name LIMIT 20`;
}

function extractHotelNames(value: unknown): readonly HotelNameRow[] {
	const text: string[] = [];
	collectText(value, text);
	const rows = new Map<string, HotelNameRow>();
	structuredHotelNameRows(value, rows);
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

function matchHotelNames(
	rows: readonly HotelNameRow[],
	reference: string
): readonly HotelCandidate[] {
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
		const script = hotelDirectoryQuery(reference);
		if (!script) return [];
		const queryTool = (await this.tools.getTools(['hotel_data'])).find(
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
							script
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
