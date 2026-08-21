import mysqlSqlParser from 'node-sql-parser/build/mysql.js';
import { AgentQueryInvalidError, AgentQueryRejectedError } from './agent-query-error';

const { Parser } = mysqlSqlParser;
const parser = new Parser();

type SqlAnalysis = Readonly<{
	isComplex: boolean;
	hotelIds: readonly string[];
	tableNames: readonly string[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function visit(value: unknown, callback: (node: Readonly<Record<string, unknown>>) => void): void {
	if (Array.isArray(value)) {
		for (const item of value) visit(item, callback);
		return;
	}
	if (!isRecord(value)) return;
	callback(value);
	for (const child of Object.values(value)) visit(child, callback);
}

function numericLiteral(value: unknown): string | null {
	if (!isRecord(value) || value.type !== 'number') return null;
	if (typeof value.value === 'number' && Number.isSafeInteger(value.value)) {
		return String(value.value);
	}
	if (typeof value.value === 'string' && /^\d+$/.test(value.value)) return value.value;
	return null;
}

function hotelPredicateIds(node: Readonly<Record<string, unknown>>): readonly string[] {
	if (node.type !== 'binary_expr' || !isRecord(node.left)) return [];
	if (node.left.type !== 'column_ref' || node.left.column !== 'hotel_id') return [];
	const operator = typeof node.operator === 'string' ? node.operator.toUpperCase() : '';
	if (operator === '=') {
		const value = numericLiteral(node.right);
		return value ? [value] : [];
	}
	if (operator !== 'IN' || !isRecord(node.right) || node.right.type !== 'expr_list') return [];
	const values = Array.isArray(node.right.value) ? node.right.value : [];
	return values.flatMap((value) => {
		const literal = numericLiteral(value);
		return literal ? [literal] : [];
	});
}

function columnReference(
	value: unknown
): Readonly<{ table: string | null; column: string }> | null {
	if (!isRecord(value) || value.type !== 'column_ref' || typeof value.column !== 'string')
		return null;
	return {
		table: typeof value.table === 'string' ? value.table.toLowerCase() : null,
		column: value.column.toLowerCase()
	};
}

function safeBooleanLeaves(value: unknown): readonly Readonly<Record<string, unknown>>[] {
	if (!isRecord(value)) return [];
	if (value.type !== 'binary_expr' || typeof value.operator !== 'string') return [value];
	const operator = value.operator.toUpperCase();
	if (operator === 'OR' || operator === 'XOR') return [];
	if (operator === 'AND')
		return [...safeBooleanLeaves(value.left), ...safeBooleanLeaves(value.right)];
	return [value];
}

function hotelPredicateRelation(
	node: Readonly<Record<string, unknown>>,
	relations: readonly string[]
): string | null {
	if (hotelPredicateIds(node).length === 0) return null;
	const column = columnReference(node.left);
	if (!column) return null;
	if (column.table) return column.table;
	return relations.length === 1 ? (relations[0] ?? null) : null;
}

function hotelEquality(node: Readonly<Record<string, unknown>>): readonly [string, string] | null {
	if (node.type !== 'binary_expr' || node.operator !== '=') return null;
	const left = columnReference(node.left);
	const right = columnReference(node.right);
	if (!left?.table || !right?.table || left.column !== 'hotel_id' || right.column !== 'hotel_id') {
		return null;
	}
	return [left.table, right.table];
}

function isConstantTrue(value: unknown): boolean {
	if (!isRecord(value)) return false;
	if (value.type === 'bool' || value.type === 'boolean') return value.value === true;
	if (value.type !== 'binary_expr' || value.operator !== '=') return false;
	const left = numericLiteral(value.left);
	const right = numericLiteral(value.right);
	return left !== null && left === right;
}

function parseSingleSelect(sql: string): Readonly<Record<string, unknown>> {
	let parsed: unknown;
	try {
		parsed = parser.astify(sql);
	} catch (cause) {
		throw new AgentQueryInvalidError('经营数据 SQL 无法按 MySQL 8.0 语法解析', { cause });
	}
	if (Array.isArray(parsed) || !isRecord(parsed) || parsed.type !== 'select') {
		throw new AgentQueryRejectedError('经营数据 SQL 只允许单条只读 SELECT 查询');
	}
	return parsed;
}

export function analyzeComplexHotelDataSql(
	sql: string,
	allowedHotelIds: readonly string[],
	databaseName?: string
): SqlAnalysis {
	const ast = parseSingleSelect(sql);
	let isComplex = Boolean(Array.isArray(ast.with) && ast.with.length > 0) || isRecord(ast._next);
	let hasCartesianJoin = false;
	const referencedHotelIds: string[] = [];
	const tableNames = new Set<string>();
	const authorized = new Set(allowedHotelIds);

	visit(ast, (node) => {
		referencedHotelIds.push(...hotelPredicateIds(node));

		if (!Array.isArray(node.from)) return;
		if (node.from.length > 1) isComplex = true;
		for (const [index, source] of node.from.entries()) {
			if (!isRecord(source)) continue;
			const join = typeof source.join === 'string' ? source.join.toUpperCase() : null;
			if (
				join === 'CROSS JOIN' ||
				(index > 0 && !join) ||
				(join !== null && !source.on && !source.using) ||
				isConstantTrue(source.on)
			) {
				hasCartesianJoin = true;
			}
			if (isRecord(source.expr)) isComplex = true;
			if (typeof source.table === 'string') tableNames.add(source.table.toLowerCase());
			if (
				databaseName &&
				typeof source.db === 'string' &&
				source.db.length > 0 &&
				source.db !== databaseName
			) {
				throw new AgentQueryRejectedError('员工酒店数据查询超出目标数据库范围');
			}
		}
	});

	if (!isComplex) {
		return { isComplex: false, hotelIds: referencedHotelIds, tableNames: [...tableNames] };
	}
	if (hasCartesianJoin) throw new AgentQueryRejectedError('酒店数据查询不允许笛卡尔连接');
	if (referencedHotelIds.some((hotelId) => !authorized.has(hotelId))) {
		throw new AgentQueryRejectedError('复杂酒店数据查询必须显式限制在当前账号的酒店范围内');
	}

	const validateSelect = (
		select: Readonly<Record<string, unknown>>,
		inheritedCtes: ReadonlyMap<string, true> = new Map()
	): void => {
		const ctes = new Map(inheritedCtes);
		if (Array.isArray(select.with)) {
			for (const candidate of select.with) {
				if (!isRecord(candidate) || !isRecord(candidate.name) || !isRecord(candidate.stmt))
					continue;
				const name = candidate.name.value;
				const statement = candidate.stmt.ast;
				if (typeof name !== 'string' || !isRecord(statement)) continue;
				validateSelect(statement, ctes);
				ctes.set(name.toLowerCase(), true);
			}
		}
		const from = Array.isArray(select.from) ? select.from.filter(isRecord) : [];
		const aliases: string[] = [];
		const alreadyScoped = new Set<string>();
		for (const source of from) {
			const tableName = typeof source.table === 'string' ? source.table.toLowerCase() : null;
			const alias =
				typeof source.as === 'string'
					? source.as.toLowerCase()
					: (tableName ?? (isRecord(source.expr) ? `derived_${aliases.length}` : null));
			if (!alias) continue;
			aliases.push(alias);
			if (tableName && ctes.has(tableName)) alreadyScoped.add(alias);
			if (isRecord(source.expr) && isRecord(source.expr.ast)) {
				validateSelect(source.expr.ast, ctes);
				alreadyScoped.add(alias);
			}
		}
		const scoped = new Set(alreadyScoped);
		const equalities: Array<readonly [string, string]> = [];
		for (const expression of [select.where, select.having, ...from.map((source) => source.on)]) {
			for (const leaf of safeBooleanLeaves(expression)) {
				const relation = hotelPredicateRelation(leaf, aliases);
				if (relation) scoped.add(relation);
				const equality = hotelEquality(leaf);
				if (equality) equalities.push(equality);
			}
		}
		let changed = true;
		while (changed) {
			changed = false;
			for (const [left, right] of equalities) {
				if (scoped.has(left) && !scoped.has(right)) {
					scoped.add(right);
					changed = true;
				}
				if (scoped.has(right) && !scoped.has(left)) {
					scoped.add(left);
					changed = true;
				}
			}
		}
		if (aliases.some((alias) => !scoped.has(alias))) {
			throw new AgentQueryRejectedError(
				'复杂酒店数据查询必须为每张业务表显式限制酒店范围或按 hotel_id 安全关联'
			);
		}
		if (isRecord(select._next)) validateSelect(select._next, ctes);
	};

	validateSelect(ast);
	return { isComplex: true, hotelIds: referencedHotelIds, tableNames: [...tableNames] };
}

export function hotelDataSqlTableNames(sql: string): readonly string[] {
	const ast = parseSingleSelect(sql);
	const tables = new Set<string>();
	visit(ast, (node) => {
		if (!Array.isArray(node.from)) return;
		for (const source of node.from) {
			if (isRecord(source) && typeof source.table === 'string') {
				tables.add(source.table.toLowerCase());
			}
		}
	});
	return [...tables];
}
