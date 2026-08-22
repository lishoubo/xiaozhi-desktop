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
type TableData = Readonly<{
	columns: readonly string[];
	rows: readonly (readonly Scalar[])[];
	truncated: boolean;
}>;

function tableData(value: unknown): TableData | null {
	const table = parseEvidenceTable(value);
	if (!table || table.rows.length === 0) return null;
	const columns = table.columns.slice(0, 12);
	return {
		columns,
		rows: table.rows
			.slice(0, HOTEL_DATA_RESULT_ROW_LIMIT)
			.map((row) => columns.map((column) => row[column] ?? null)),
		truncated:
			table.columns.length > columns.length || table.rows.length > HOTEL_DATA_RESULT_ROW_LIMIT
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
	const domainLabels = Array.isArray(domains)
		? [
				...new Set(
					domains.flatMap((domain) => {
						const known = knownDomains.find((candidate) => candidate === domain);
						return known ? [hotelDataDomainLabel(known)] : [];
					})
				)
			]
		: [];
	const tableLabels = Array.isArray(tables)
		? [...new Set(tables.filter((table): table is string => typeof table === 'string'))]
		: [];
	return (
		[domainLabels.join('/'), tableLabels.join(', ')].filter(Boolean).join(' · ') || `查询 ${index}`
	);
}

function fairResultSetTables(
	resultSets: readonly Readonly<{
		source: EvidenceRecord;
		table: TableData;
		index: number;
	}>[]
): readonly Readonly<{ label: string; table: TableData }>[] {
	const baseQuota = Math.floor(HOTEL_DATA_RESULT_ROW_LIMIT / resultSets.length);
	let remainder = HOTEL_DATA_RESULT_ROW_LIMIT % resultSets.length;
	return resultSets.map((resultSet) => {
		const quota = baseQuota + (remainder-- > 0 ? 1 : 0);
		return {
			label: resultSetLabel(resultSet.source, resultSet.index),
			table: {
				...resultSet.table,
				rows: resultSet.table.rows.slice(0, quota),
				truncated: resultSet.table.truncated || resultSet.table.rows.length > quota
			}
		};
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
	const displaySets = fairResultSetTables(resultSets);
	const displayedRows = displaySets.reduce(
		(count, resultSet) => count + resultSet.table.rows.length,
		0
	);
	const wasFiltered =
		sources.some((source) => filtered(source.data)) ||
		displaySets.some((resultSet) => resultSet.table.truncated);
	const elements: GenerativeUiSpec['elements'] =
		displaySets.length === 1
			? {
					root: { type: 'Card', props: {}, children: ['result'], visible: true },
					result: {
						type: 'Table',
						props: {
							columns: displaySets[0]?.table.columns ?? [],
							rows: displaySets[0]?.table.rows ?? []
						},
						children: [],
						visible: true
					}
				}
			: Object.fromEntries([
					[
						'root',
						{
							type: 'Stack',
							props: { direction: 'vertical', gap: 'lg', align: 'stretch', justify: 'start' },
							children: displaySets.flatMap((_, index) => [
								`heading-${index + 1}`,
								`table-${index + 1}`
							]),
							visible: true
						}
					],
					...displaySets.flatMap((resultSet, index) => [
						[
							`heading-${index + 1}`,
							{
								type: 'Heading',
								props: { text: resultSet.label, level: 'h3' },
								children: [],
								visible: true
							}
						],
						[
							`table-${index + 1}`,
							{
								type: 'Table',
								props: { columns: resultSet.table.columns, rows: resultSet.table.rows },
								children: [],
								visible: true
							}
						]
					])
				]);
	return {
		content: [
			resultSets.length === 1
				? `已查询到 ${displayedRows} 条酒店数据记录，按数据源返回顺序展示。`
				: `已查询到 ${resultSets.length} 组酒店数据，共展示 ${displayedRows} 条记录。`,
			wasFiltered ? '结果经过行数、字段或长度裁剪，不代表完整明细。' : '',
			'数据来源：阿里云 DMS MCP。'
		]
			.filter(Boolean)
			.join('\n\n'),
		ui: validateHotelUi({ root: 'root', state: {}, elements })
	};
}
