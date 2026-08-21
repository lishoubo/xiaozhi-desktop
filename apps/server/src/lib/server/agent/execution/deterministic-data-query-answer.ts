import type { GenerativeUiSpec } from '@hotel-butler/api';
import { HOTEL_DATA_RESULT_ROW_LIMIT, HOTEL_DATA_SQL_TOOL_NAME } from '../hotel-data-mcp';
import { hotelDataDomainLabel, type HotelDataDomain } from '../hotel-data-semantic-catalog';
import { validateHotelUi } from '../hotel-ui-validator';
import type {
	EvidenceRecord,
	JsonValue,
	ResolvedBusinessRequest
} from './business-execution-state';
import { parseEvidenceTable } from './evidence-table';

type Scalar = string | number | boolean | null;
type TableData = Readonly<{ columns: readonly string[]; rows: readonly (readonly Scalar[])[] }>;

function tableData(value: unknown): TableData | null {
	const table = parseEvidenceTable(value);
	if (!table || table.rows.length === 0) return null;
	const columns = table.columns.slice(0, 12);
	return {
		columns,
		rows: table.rows
			.slice(0, HOTEL_DATA_RESULT_ROW_LIMIT)
			.map((row) => columns.map((column) => row[column] ?? null))
	};
}

function filtered(value: JsonValue, depth = 0): boolean {
	if (depth > 8) return false;
	if (typeof value === 'string') return value.includes('[DATA_RESULT_FILTERED]');
	if (Array.isArray(value)) return value.some((item) => filtered(item, depth + 1));
	if (typeof value !== 'object' || value === null) return false;
	if (Reflect.get(value, 'filtered') === true) return true;
	return Object.values(value).some((item) => filtered(item, depth + 1));
}

function resultSetLabel(source: EvidenceRecord, index: number): string {
	if (typeof source.data !== 'object' || source.data === null || Array.isArray(source.data)) {
		return `查询 ${index}`;
	}
	const provenance = Reflect.get(source.data, 'provenance');
	if (typeof provenance !== 'object' || provenance === null || Array.isArray(provenance)) {
		return `查询 ${index}`;
	}
	const domains = Reflect.get(provenance, 'domains');
	const tables = Reflect.get(provenance, 'tables');
	const domain = Array.isArray(domains) && typeof domains[0] === 'string' ? domains[0] : null;
	const table = Array.isArray(tables) && typeof tables[0] === 'string' ? tables[0] : null;
	const knownDomains: readonly HotelDataDomain[] = [
		'operating',
		'traffic_conversion',
		'content',
		'search',
		'crowd',
		'marketing',
		'reviews_scores',
		'orders',
		'sync'
	];
	const domainLabel = knownDomains.find((candidate) => candidate === domain);
	return (
		[domainLabel ? hotelDataDomainLabel(domainLabel) : null, table].filter(Boolean).join(' · ') ||
		`查询 ${index}`
	);
}

function rowsWithFairResultSetAllocation(
	resultSets: readonly Readonly<{
		source: EvidenceRecord;
		table: TableData;
		index: number;
	}>[],
	dataColumns: readonly string[]
): readonly (readonly Scalar[])[] {
	const baseQuota = Math.floor(HOTEL_DATA_RESULT_ROW_LIMIT / resultSets.length);
	let remainder = HOTEL_DATA_RESULT_ROW_LIMIT % resultSets.length;
	return resultSets.flatMap((resultSet) => {
		const quota = baseQuota + (remainder-- > 0 ? 1 : 0);
		return resultSet.table.rows.slice(0, quota).map((row) => {
			const values = new Map(
				resultSet.table.columns.map((column, index) => [column, row[index] ?? null])
			);
			return [
				resultSetLabel(resultSet.source, resultSet.index),
				...dataColumns.map((column) => values.get(column) ?? null)
			];
		});
	});
}

export function buildDeterministicDataQueryAnswer(
	request: ResolvedBusinessRequest,
	evidence: readonly EvidenceRecord[]
): Readonly<{ content: string; ui: GenerativeUiSpec }> | null {
	if (request.intent !== 'generic_hotel_data_query') return null;
	const sources = evidence.filter(
		(item) =>
			item.source === 'aliyun_dms_mcp' &&
			typeof item.data === 'object' &&
			item.data !== null &&
			!Array.isArray(item.data) &&
			Reflect.get(item.data, 'toolName') === HOTEL_DATA_SQL_TOOL_NAME
	);
	const resultSets = sources.flatMap((source, index) => {
		const table = tableData(source.data);
		return table && table.rows.length > 0 ? [{ source, table, index: index + 1 }] : [];
	});
	if (resultSets.length === 0) return null;
	const table =
		resultSets.length === 1
			? resultSets[0]?.table
			: (() => {
					const columns = [
						'结果集',
						...new Set(resultSets.flatMap((resultSet) => resultSet.table.columns))
					].slice(0, 12);
					const dataColumns = columns.slice(1);
					return {
						columns,
						rows: rowsWithFairResultSetAllocation(resultSets, dataColumns)
					};
				})();
	if (!table) return null;
	const totalSourceRows = resultSets.reduce(
		(count, resultSet) => count + resultSet.table.rows.length,
		0
	);
	const totalColumns = new Set(resultSets.flatMap((resultSet) => resultSet.table.columns)).size;
	const wasFiltered =
		sources.some((source) => filtered(source.data)) ||
		totalSourceRows > HOTEL_DATA_RESULT_ROW_LIMIT ||
		(resultSets.length > 1 && totalColumns > 11);
	return {
		content: [
			resultSets.length === 1
				? `已查询到 ${table.rows.length} 条酒店数据记录，按数据源返回顺序展示。`
				: `已查询到 ${resultSets.length} 组酒店数据，共展示 ${table.rows.length} 条记录。`,
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
