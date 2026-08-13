import type { DynamicStructuredTool } from '@langchain/core/tools';
import { HOTEL_DATA_SQL_TOOL_NAME } from '../hotel-data-mcp';
import type { HotelCandidate, HotelReferenceResolver } from './slot-resolver';

type McpToolsPort = Readonly<{ getTools(): Promise<readonly DynamicStructuredTool[]> }>;

function parseJson(value: unknown): unknown {
	if (typeof value !== 'string') return value;
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectRows(value: unknown, rows: Record<string, unknown>[], depth = 0): void {
	if (depth > 8) return;
	const parsed = parseJson(value);
	if (Array.isArray(parsed)) {
		for (const item of parsed) collectRows(item, rows, depth + 1);
		return;
	}
	if (!isRecord(parsed)) return;
	const record = parsed;
	const id = record.hotelId ?? record.hotel_id ?? record.hotelCode ?? record.hotel_code;
	const label = record.hotelName ?? record.hotel_name ?? record.name;
	if ((typeof id === 'string' || typeof id === 'number') && typeof label === 'string')
		rows.push(record);
	for (const item of Object.values(record)) collectRows(item, rows, depth + 1);
}

function normalized(value: string): string {
	return value
		.trim()
		.toLocaleLowerCase('zh-CN')
		.replace(/[\s·・_-]/g, '');
}

export class McpHotelReferenceResolver implements HotelReferenceResolver {
	constructor(private readonly tools: McpToolsPort) {}

	async resolve(reference: string): Promise<readonly HotelCandidate[]> {
		if (!/^\d+$/.test(reference)) return [];
		const queryTool = (await this.tools.getTools()).find(
			(tool) => tool.name === HOTEL_DATA_SQL_TOOL_NAME
		);
		if (!queryTool) return [];
		const result = await queryTool.invoke({
			database_id: 'server-configured',
			script: `SELECT DISTINCT hotel_id, CAST(hotel_id AS CHAR) AS hotel_name FROM fact_business_daily WHERE hotel_id = ${reference} LIMIT 10`
		});
		const rows: Record<string, unknown>[] = [];
		collectRows(result, rows);
		const target = normalized(reference);
		const unique = new Map<string, HotelCandidate>();
		for (const row of rows) {
			const rawId = row.hotelId ?? row.hotel_id ?? row.hotelCode ?? row.hotel_code;
			const rawLabel = row.hotelName ?? row.hotel_name ?? row.name;
			if (
				(typeof rawId !== 'string' && typeof rawId !== 'number') ||
				typeof rawLabel !== 'string'
			) {
				continue;
			}
			const id = String(rawId);
			const label = rawLabel.trim();
			const match =
				normalized(id) === target || normalized(label) === target
					? 'exact'
					: normalized(label).includes(target) || target.includes(normalized(label))
						? 'alias'
						: 'fuzzy';
			unique.set(id, { id, label, match, accessScope: 'shared_dms_token' });
		}
		return [...unique.values()].slice(0, 10);
	}
}
