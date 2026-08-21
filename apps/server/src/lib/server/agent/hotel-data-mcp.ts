import { HOTEL_DATA_TABLES } from './hotel-data-business-catalog';
import { analyzeComplexHotelDataSql, hotelDataSqlTableNames } from './hotel-data-sql-policy';
import { AgentQueryInvalidError, AgentQueryRejectedError } from './agent-query-error';

export const DMS_GENERATE_SQL_TOOL_NAME = 'generateSql';
export const DMS_SQL_TOOL_NAME = 'executeScript';
export const DMS_LIST_TABLES_TOOL_NAME = 'listTables';
export const DMS_DESCRIBE_TABLE_TOOL_NAME = 'getTableDetailInfo';
export const DMS_SEARCH_DATABASE_TOOL_NAME = 'searchDatabase';

export const HOTEL_DATA_GENERATE_SQL_TOOL_NAME = 'generate_hotel_operating_data_sql';
export const HOTEL_DATA_SQL_TOOL_NAME = 'query_hotel_operating_data_sql';
export const HOTEL_DATA_LIST_TABLES_TOOL_NAME = 'list_hotel_data_tables';
export const HOTEL_DATA_DESCRIBE_TABLE_TOOL_NAME = 'describe_hotel_data_table';

export const HOTEL_DATA_RESULT_ROW_LIMIT = 75;
const MAX_RESULT_CHARACTERS = 40_000;
const MAX_VALUE_CHARACTERS = 1_000;
const MAX_MARKDOWN_TABLE_CHARACTERS = 10_000;
const CREDENTIAL_FIELD = /authorization|cookie|credential|password|passwd|secret|token/i;
const FORBIDDEN_SQL =
	/\b(insert|update|delete|replace|merge|upsert|create|alter|drop|truncate|rename|grant|revoke|call|handler|load|lock|unlock|set|use|transaction|commit|rollback|savepoint|prepare|execute|deallocate|outfile|dumpfile|sleep|benchmark|load_file|get_lock|release_lock|is_free_lock|is_used_lock)\b|\bfor\s+update\b|\block\s+in\s+share\s+mode\b|\binto\b|:=/i;

type CompactionStats = {
	omittedRows: number;
	redactedFields: number;
	truncatedValues: number;
};

export type DmsDatabaseDiscovery =
	Readonly<{ status: 'unavailable' }> | Readonly<{ status: 'completed'; result: unknown }>;

export type DmsDatabaseResolution = Readonly<{
	databaseId: string;
	source: 'discovered' | 'configured_fallback';
}>;

export function isHotelDataToolName(name: string): boolean {
	return [
		HOTEL_DATA_GENERATE_SQL_TOOL_NAME,
		HOTEL_DATA_SQL_TOOL_NAME,
		HOTEL_DATA_LIST_TABLES_TOOL_NAME,
		HOTEL_DATA_DESCRIBE_TABLE_TOOL_NAME
	].includes(name);
}

export function isAllowedHotelDataMcpToolName(name: string): boolean {
	return [
		DMS_SEARCH_DATABASE_TOOL_NAME,
		DMS_GENERATE_SQL_TOOL_NAME,
		DMS_SQL_TOOL_NAME,
		DMS_LIST_TABLES_TOOL_NAME,
		DMS_DESCRIBE_TABLE_TOOL_NAME
	].includes(name);
}

function collectDatabaseCandidates(value: unknown, candidates: Record<string, unknown>[]): void {
	let parsed = value;
	if (typeof value === 'string') {
		try {
			parsed = JSON.parse(value);
		} catch {
			return;
		}
	}
	if (Array.isArray(parsed)) {
		for (const item of parsed) collectDatabaseCandidates(item, candidates);
		return;
	}
	if (typeof parsed !== 'object' || parsed === null) return;
	const record = Object.fromEntries(Object.entries(parsed));
	if ('DatabaseId' in record && 'SchemaName' in record) candidates.push(record);
	for (const item of Object.values(record)) collectDatabaseCandidates(item, candidates);
}

export function resolveDmsDatabaseId(
	discovery: DmsDatabaseDiscovery,
	databaseName: string,
	pinnedDatabaseId: string | null
): DmsDatabaseResolution {
	if (discovery.status === 'unavailable') {
		if (pinnedDatabaseId) {
			return { databaseId: pinnedDatabaseId, source: 'configured_fallback' };
		}
		throw new Error(
			'DMS database discovery is unavailable and AI_DMS_DATABASE_ID is not configured'
		);
	}
	const candidates: Record<string, unknown>[] = [];
	collectDatabaseCandidates(discovery.result, candidates);
	const exact = candidates.filter(
		(candidate) => typeof candidate.SchemaName === 'string' && candidate.SchemaName === databaseName
	);
	const exactIds = new Set(
		exact.flatMap((candidate) => {
			const value = candidate.DatabaseId;
			if (typeof value === 'number' && Number.isSafeInteger(value)) return [String(value)];
			if (typeof value === 'string' && /^\d+$/.test(value)) return [value];
			return [];
		})
	);
	if (pinnedDatabaseId) {
		if (exactIds.size === 0) {
			return { databaseId: pinnedDatabaseId, source: 'configured_fallback' };
		}
		if (!exactIds.has(pinnedDatabaseId)) {
			throw new Error('Discovered DMS DatabaseId does not match AI_DMS_DATABASE_ID');
		}
		return { databaseId: pinnedDatabaseId, source: 'discovered' };
	}
	if (exactIds.size !== 1) {
		throw new Error(
			`DMS database discovery did not return a unique exact match for ${databaseName}`
		);
	}
	const databaseId = [...exactIds][0];
	if (!databaseId) throw new Error('DMS database discovery returned an invalid DatabaseId');
	return { databaseId, source: 'discovered' };
}

export function selectDmsDatabaseId(
	result: unknown,
	databaseName: string,
	pinnedDatabaseId: string | null
): string {
	return resolveDmsDatabaseId({ status: 'completed', result }, databaseName, pinnedDatabaseId)
		.databaseId;
}

export function constrainHotelDataGenerateSqlArgs(args: unknown, databaseId: string): unknown {
	if (typeof args !== 'object' || args === null || Array.isArray(args)) {
		throw new Error('DMS generateSql 参数格式无效');
	}
	const parameters = Object.fromEntries(Object.entries(args));
	const question = parameters.question;
	if (typeof question !== 'string' || !question.trim()) {
		throw new Error('DMS generateSql 缺少自然语言查询参数');
	}
	return {
		...parameters,
		database_id: databaseId,
		question: `${question}\n\n结果约束（系统强制）：只生成一条完成问题所需的只读 SELECT；优先聚合、趋势、Top N 和异常，明细最多 ${HOTEL_DATA_RESULT_ROW_LIMIT} 行。`
	};
}

function redactText(value: string, stats: CompactionStats): string {
	let text = value
		.replace(/Bearer\s+[A-Za-z0-9._~+-]+/gi, 'Bearer [REDACTED]')
		.replace(/\bDMS-[A-Za-z0-9-]{16,}\b/g, '[REDACTED_DMS_TOKEN]');
	const valueLimit = /^\|[^\n]+\|\n\|\s*:?-{3,}/.test(text.trimStart())
		? MAX_MARKDOWN_TABLE_CHARACTERS
		: MAX_VALUE_CHARACTERS;
	if (text.length > valueLimit) {
		text = `${text.slice(0, valueLimit)}…[值已截断]`;
		stats.truncatedValues += 1;
	}
	return text;
}

function compactValue(value: unknown, stats: CompactionStats, depth = 0): unknown {
	if (depth > 12) {
		stats.truncatedValues += 1;
		return '[嵌套内容已省略]';
	}
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (depth < 12 && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
			try {
				return compactValue(JSON.parse(trimmed), stats, depth + 1);
			} catch {
				// The value is ordinary text rather than embedded JSON.
			}
		}
		return redactText(value, stats);
	}
	if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
	if (Array.isArray(value)) {
		if (value.length > HOTEL_DATA_RESULT_ROW_LIMIT) {
			stats.omittedRows += value.length - HOTEL_DATA_RESULT_ROW_LIMIT;
		}
		return value
			.slice(0, HOTEL_DATA_RESULT_ROW_LIMIT)
			.map((item) => compactValue(item, stats, depth + 1));
	}
	if (typeof value !== 'object') return String(value);
	return Object.fromEntries(
		Object.entries(value).map(([key, item]) => {
			if (CREDENTIAL_FIELD.test(key)) {
				stats.redactedFields += 1;
				return [key, '[REDACTED]'];
			}
			return [key, compactValue(item, stats, depth + 1)];
		})
	);
}

function resultNotice(stats: CompactionStats): string {
	const changes = [
		stats.omittedRows > 0 ? `省略 ${stats.omittedRows} 行` : '',
		stats.redactedFields > 0 ? `隐藏 ${stats.redactedFields} 个凭证字段` : '',
		stats.truncatedValues > 0 ? `截断 ${stats.truncatedValues} 个过长值` : ''
	].filter(Boolean);
	return changes.length
		? `\n\n[DATA_RESULT_FILTERED] 为适合对话界面展示，结果已${changes.join('、')}。请在回答中明确告知用户，并优先总结趋势、合计和异常，不要声称展示了完整明细。`
		: '';
}

export function compactHotelDataResult(content: unknown): string {
	const stats: CompactionStats = { omittedRows: 0, redactedFields: 0, truncatedValues: 0 };
	let parsed: unknown = content;
	if (typeof content === 'string') {
		try {
			parsed = JSON.parse(content);
		} catch {
			const redacted = redactText(content, stats);
			if (redacted.length <= MAX_RESULT_CHARACTERS) return `${redacted}${resultNotice(stats)}`;
			stats.truncatedValues += 1;
			return `${redacted.slice(0, MAX_RESULT_CHARACTERS)}…[结果已截断]${resultNotice(stats)}`;
		}
	}
	const serialized = JSON.stringify(compactValue(parsed, stats));
	if (serialized.length <= MAX_RESULT_CHARACTERS) return `${serialized}${resultNotice(stats)}`;
	stats.truncatedValues += 1;
	return `${serialized.slice(0, MAX_RESULT_CHARACTERS)}…[结果已截断]${resultNotice(stats)}`;
}

type SqlToken = Readonly<{ value: string; start: number; end: number; depth: number }>;

function mysqlTokens(sql: string): readonly SqlToken[] {
	const tokens: SqlToken[] = [];
	let depth = 0;
	for (let index = 0; index < sql.length;) {
		const character = sql[index];
		if (character === "'" || character === '"' || character === '`') {
			const quote = character;
			index += 1;
			while (index < sql.length) {
				if (sql[index] === '\\') {
					index += 2;
					continue;
				}
				if (sql[index] === quote) {
					if (sql[index + 1] === quote) {
						index += 2;
						continue;
					}
					index += 1;
					break;
				}
				index += 1;
			}
			continue;
		}
		if (character === '(') {
			depth += 1;
			index += 1;
			continue;
		}
		if (character === ')') {
			depth = Math.max(0, depth - 1);
			index += 1;
			continue;
		}
		if (character && /[A-Za-z_]/.test(character)) {
			const start = index;
			index += 1;
			while (index < sql.length && /[A-Za-z0-9_$]/.test(sql[index] ?? '')) index += 1;
			tokens.push({ value: sql.slice(start, index).toLowerCase(), start, end: index, depth });
			continue;
		}
		index += 1;
	}
	return tokens;
}

function scopeHotelDataSql(
	sql: string,
	allowedHotelIds: readonly string[],
	databaseName?: string
): string {
	if (allowedHotelIds.length === 0) throw new AgentQueryRejectedError('当前账号没有可查询的酒店');
	if (!allowedHotelIds.every((id) => /^\d+$/.test(id))) {
		throw new AgentQueryRejectedError('酒店数据访问范围无效');
	}
	const tokens = mysqlTokens(sql);
	if (analyzeComplexHotelDataSql(sql, allowedHotelIds, databaseName).isComplex) return sql;
	const from = tokens.find((token) => token.depth === 0 && token.value === 'from');
	if (!from) {
		throw new AgentQueryInvalidError('员工酒店数据查询缺少单一数据表');
	}
	const clauseEnd =
		tokens.find(
			(token) =>
				token.depth === 0 &&
				token.start > from.end &&
				['where', 'group', 'order', 'having', 'limit'].includes(token.value)
		)?.start ?? sql.length;
	const sourceClause = sql.slice(from.end, clauseEnd).trim();
	const identifier = '`?[A-Za-z_][A-Za-z0-9_$-]*`?';
	const sourcePattern = new RegExp(
		`^(${identifier}(?:\\s*\\.\\s*${identifier})?)(?:\\s+(?:as\\s+)?(${identifier}))?$`,
		'i'
	);
	const parsedSource = sourcePattern.exec(sourceClause);
	if (!parsedSource) {
		throw new AgentQueryInvalidError('员工酒店数据查询的数据表结构无效');
	}
	const table = parsedSource[1];
	if (!table) throw new AgentQueryInvalidError('员工酒店数据查询的数据表无效');
	const qualifiedParts = table.split('.').map((part) => part.trim().replace(/^`|`$/g, ''));
	if (qualifiedParts.length === 2 && databaseName && qualifiedParts[0] !== databaseName) {
		throw new AgentQueryRejectedError('员工酒店数据查询超出目标数据库范围');
	}
	const alias = parsedSource[2] ?? table.split('.').at(-1)?.trim();
	if (!alias) throw new AgentQueryInvalidError('员工酒店数据查询的数据表别名无效');
	const authorizedIds = allowedHotelIds.join(', ');
	const scopedSource = ` (SELECT * FROM ${table} WHERE hotel_id IN (${authorizedIds})) AS ${alias} `;
	return `${sql.slice(0, from.end)}${scopedSource}${sql.slice(clauseEnd)}`;
}

const ALWAYS_PRIVATE_HOTEL_DATA_FIELDS = new Set(['raw_payload', 'data_payload', 'cookie_cipher']);

function sqlMentionsIdentifier(sql: string, identifier: string): boolean {
	const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(
		`(?:^|[^A-Za-z0-9_$])(?:\\\`${escaped}\\\`|${escaped})(?:$|[^A-Za-z0-9_$])`,
		'i'
	).test(sql);
}

export function enforceHotelDataProjectionPolicy(sql: string): void {
	const referenced = hotelDataSqlTableNames(sql).flatMap((name) => {
		const table = HOTEL_DATA_TABLES.find((candidate) => candidate.name === name);
		return table ? [table] : [];
	});
	const forbidden = new Set([
		...referenced.flatMap((table) => table.sensitiveFields),
		...ALWAYS_PRIVATE_HOTEL_DATA_FIELDS
	]);
	const selectedForbidden = [...forbidden].find((field) => sqlMentionsIdentifier(sql, field));
	if (selectedForbidden) {
		throw new AgentQueryRejectedError(`酒店数据查询不允许访问敏感字段 ${selectedForbidden}`);
	}
	if (
		referenced.some((table) => table.sensitiveFields.length > 0 || table.fallbackOnly) &&
		/\bselect\s+(?:[A-Za-z_][A-Za-z0-9_$]*\s*\.\s*)?\*/i.test(sql)
	) {
		throw new AgentQueryRejectedError('酒店数据查询不允许对敏感或后备数据表使用 SELECT *');
	}
}

export function constrainHotelDataSqlArgs(
	args: unknown,
	databaseId?: string,
	allowedHotelIds?: readonly string[],
	databaseName?: string
): unknown {
	if (typeof args !== 'object' || args === null || Array.isArray(args)) {
		throw new AgentQueryRejectedError('DMS executeScript 参数格式无效');
	}
	const parameters = Object.fromEntries(Object.entries(args));
	const script = parameters.script;
	if (typeof script !== 'string' || !script.trim()) {
		throw new AgentQueryInvalidError('DMS executeScript 缺少 SQL');
	}
	let sql = script.trim();
	if (sql.length > 20_000) throw new AgentQueryRejectedError('经营数据 SQL 过长');
	if (/\0|--|#|\/\*/.test(sql)) {
		throw new AgentQueryRejectedError('经营数据 SQL 不允许注释或控制字符');
	}
	if (sql.endsWith(';')) sql = sql.slice(0, -1).trim();
	if (sql.includes(';')) throw new AgentQueryRejectedError('经营数据 SQL 只允许单条语句');
	if (!/^(select|with)\b/i.test(sql)) {
		throw new AgentQueryRejectedError('经营数据 SQL 只允许 SELECT 或 CTE 查询');
	}
	if (FORBIDDEN_SQL.test(sql)) {
		throw new AgentQueryRejectedError('经营数据 SQL 包含不允许的操作');
	}
	if (allowedHotelIds) analyzeComplexHotelDataSql(sql, allowedHotelIds, databaseName);
	enforceHotelDataProjectionPolicy(sql);
	if (allowedHotelIds) sql = scopeHotelDataSql(sql, allowedHotelIds, databaseName);
	return {
		...parameters,
		...(databaseId ? { database_id: databaseId } : {}),
		script: `SELECT * FROM (${sql}) AS data_agent_result LIMIT ${HOTEL_DATA_RESULT_ROW_LIMIT}`
	};
}

export function constrainHotelDataTableListArgs(args: unknown, databaseId?: string): unknown {
	if (typeof args !== 'object' || args === null || Array.isArray(args)) {
		return {
			...(databaseId ? { database_id: databaseId } : {}),
			page_number: 1,
			page_size: 50,
			return_guid: true
		};
	}
	const parameters = Object.fromEntries(Object.entries(args));
	const pageNumber = typeof parameters.page_number === 'number' ? parameters.page_number : 1;
	const pageSize = typeof parameters.page_size === 'number' ? parameters.page_size : 50;
	return {
		...parameters,
		...(databaseId ? { database_id: databaseId } : {}),
		page_number: Math.max(1, Math.trunc(pageNumber)),
		page_size: Math.min(50, Math.max(1, Math.trunc(pageSize))),
		return_guid: true
	};
}

export function isEmptyHotelDataTableListResult(result: unknown): boolean {
	if (
		typeof result === 'object' &&
		result !== null &&
		(Reflect.get(result, 'TotalCount') === 0 || Reflect.get(result, 'total_count') === 0)
	) {
		return true;
	}
	const texts: string[] = [];
	const collectText = (value: unknown, depth = 0): void => {
		if (depth > 6) return;
		if (typeof value === 'string') {
			texts.push(value);
			return;
		}
		if (Array.isArray(value)) {
			for (const item of value) collectText(item, depth + 1);
			return;
		}
		if (typeof value === 'object' && value !== null) {
			for (const item of Object.values(value)) collectText(item, depth + 1);
		}
	};
	collectText(result);
	if (
		texts.some(
			(text) =>
				/(?:"|\b)TotalCount(?:"|\b)\s*:\s*0\b/i.test(text) ||
				/(?:"|\b)total_count(?:"|\b)\s*:\s*0\b/i.test(text)
		)
	) {
		return true;
	}
	try {
		const parsed: unknown = typeof result === 'string' ? JSON.parse(result) : result;
		if (typeof parsed !== 'object' || parsed === null) return false;
		const tableList = Reflect.get(parsed, 'TableList') ?? Reflect.get(parsed, 'table_list');
		if (typeof tableList !== 'object' || tableList === null) return false;
		const tables = Reflect.get(tableList, 'Table') ?? Reflect.get(tableList, 'table');
		return Array.isArray(tables) && tables.length === 0;
	} catch {
		return false;
	}
}

export function constrainHotelDataTableDetailArgs(args: unknown, databaseName: string): unknown {
	if (typeof args !== 'object' || args === null || Array.isArray(args)) {
		throw new Error('DMS getTableDetailInfo 参数格式无效');
	}
	const tableGuid = Reflect.get(args, 'table_guid');
	if (typeof tableGuid !== 'string') throw new Error('DMS getTableDetailInfo 缺少 table_guid');
	const parts = tableGuid.split('.');
	if (
		parts.length !== 3 ||
		!/^IDB_\d+$/.test(parts[0] ?? '') ||
		parts[1] !== databaseName ||
		!/^[A-Za-z0-9_$-]+$/.test(parts[2] ?? '')
	) {
		throw new Error('DMS table_guid is outside the discovered database');
	}
	return { table_guid: tableGuid };
}

export function compactHotelDataToolResult(
	result: readonly [unknown, readonly unknown[]]
): [string, []] {
	return [compactHotelDataResult(result[0]), []];
}
