import type { GenerativeUiSpec } from '@hotel-butler/api';
import { HOTEL_DATA_RESULT_ROW_LIMIT, HOTEL_DATA_SQL_TOOL_NAME } from '../hotel-data-mcp';
import { validateHotelUi } from '../hotel-ui-validator';
import type {
	EvidenceRecord,
	JsonValue,
	ResolvedBusinessRequest
} from './business-execution-state';

type Scalar = string | number | boolean | null;
type TableData = Readonly<{ columns: readonly string[]; rows: readonly (readonly Scalar[])[] }>;

function scalar(value: unknown): Scalar {
	if (value === undefined) return null;
	if (
		value === null ||
		typeof value === 'string' ||
		typeof value === 'boolean' ||
		(typeof value === 'number' && Number.isFinite(value))
	) {
		return value;
	}
	const serialized = JSON.stringify(value);
	return serialized.length > 500 ? `${serialized.slice(0, 500)}…` : serialized;
}

function markdownTable(text: string): TableData | null {
	const lines = text
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.startsWith('|') && line.endsWith('|'));
	if (lines.length < 3) return null;
	const cells = (line: string): string[] =>
		line
			.slice(1, -1)
			.split('|')
			.map((cell) => cell.trim());
	const columns = cells(lines[0] ?? '').slice(0, 12);
	const separator = cells(lines[1] ?? '');
	if (
		columns.length === 0 ||
		separator.length < columns.length ||
		!separator.slice(0, columns.length).every((cell) => /^:?-{3,}:?$/.test(cell))
	) {
		return null;
	}
	const rows = lines.slice(2, HOTEL_DATA_RESULT_ROW_LIMIT + 2).flatMap((line) => {
		const values = cells(line);
		return values.length >= columns.length ? [values.slice(0, columns.length)] : [];
	});
	return rows.length ? { columns, rows } : null;
}

function objectRows(values: readonly Record<string, unknown>[]): TableData | null {
	const columns = [...new Set(values.flatMap((value) => Object.keys(value)))].slice(0, 12);
	if (columns.length === 0) return null;
	return {
		columns,
		rows: values
			.slice(0, HOTEL_DATA_RESULT_ROW_LIMIT)
			.map((value) => columns.map((column) => scalar(value[column])))
	};
}

function tableData(value: unknown, depth = 0): TableData | null {
	if (depth > 8) return null;
	if (typeof value === 'string') {
		try {
			const parsed: unknown = JSON.parse(value);
			if (parsed !== value) {
				const parsedTable = tableData(parsed, depth + 1);
				if (parsedTable) return parsedTable;
			}
		} catch {
			// The value is ordinary text rather than embedded JSON.
		}
		return (
			markdownTable(value) ??
			(value.trim() ? { columns: ['查询结果'], rows: [[scalar(value.trim())]] } : null)
		);
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return { columns: ['查询结果'], rows: [[value]] };
	}
	if (Array.isArray(value)) {
		const textBlocks = value.flatMap((item) => {
			if (typeof item !== 'object' || item === null || Reflect.get(item, 'type') !== 'text')
				return [];
			const text = Reflect.get(item, 'text');
			return typeof text === 'string' ? [text] : [];
		});
		if (textBlocks.length === value.length && textBlocks.length > 0) {
			return tableData(textBlocks.join('\n'), depth + 1);
		}
		const records = value.filter(
			(item): item is Record<string, unknown> =>
				typeof item === 'object' && item !== null && !Array.isArray(item)
		);
		if (records.length === value.length && records.length > 0) return objectRows(records);
		if (
			value.length > 0 &&
			value.every(
				(item) =>
					item === null ||
					typeof item === 'string' ||
					typeof item === 'number' ||
					typeof item === 'boolean'
			)
		) {
			return {
				columns: ['查询结果'],
				rows: value.slice(0, HOTEL_DATA_RESULT_ROW_LIMIT).map((item) => [scalar(item)])
			};
		}
		return null;
	}
	if (typeof value !== 'object' || value === null) return null;
	let hasContainerField = false;
	for (const key of ['data', 'rows', 'records', 'items', 'result']) {
		if (!Reflect.has(value, key)) continue;
		hasContainerField = true;
		const nested = tableData(Reflect.get(value, key), depth + 1);
		if (nested) return nested;
	}
	if (hasContainerField) return null;
	return objectRows([Object.fromEntries(Object.entries(value))]);
}

function filtered(value: JsonValue, depth = 0): boolean {
	if (depth > 8) return false;
	if (typeof value === 'string') return value.includes('[DATA_RESULT_FILTERED]');
	if (Array.isArray(value)) return value.some((item) => filtered(item, depth + 1));
	if (typeof value !== 'object' || value === null) return false;
	if (Reflect.get(value, 'filtered') === true) return true;
	return Object.values(value).some((item) => filtered(item, depth + 1));
}

export function buildDeterministicDataQueryAnswer(
	request: ResolvedBusinessRequest,
	evidence: readonly EvidenceRecord[]
): Readonly<{ content: string; ui: GenerativeUiSpec }> | null {
	if (request.intent !== 'generic_hotel_data_query') return null;
	const source = evidence.findLast(
		(item) =>
			item.source === 'aliyun_dms_mcp' &&
			typeof item.data === 'object' &&
			item.data !== null &&
			!Array.isArray(item.data) &&
			Reflect.get(item.data, 'toolName') === HOTEL_DATA_SQL_TOOL_NAME
	);
	const table = source ? tableData(source.data) : null;
	if (!source || !table || table.rows.length === 0) return null;
	const wasFiltered = filtered(source.data);
	return {
		content: [
			`已查询到 ${table.rows.length} 条酒店数据记录，按数据源返回顺序展示。`,
			wasFiltered ? '结果经过行数、字段或长度裁剪，不代表完整明细。' : '',
			'数据来源：阿里云 DMS MCP。'
		]
			.filter(Boolean)
			.join('\n\n'),
		ui: validateHotelUi({
			root: 'root',
			state: {},
			elements: {
				root: { type: 'Card', props: {}, children: ['result'], visible: true },
				result: {
					type: 'Table',
					props: { columns: table.columns, rows: table.rows },
					children: [],
					visible: true
				}
			}
		})
	};
}
