import mysqlSqlParser from 'node-sql-parser/build/mysql.js';
import { AgentQueryInvalidError, AgentQueryRejectedError } from './agent-query-error';

const { Parser } = mysqlSqlParser;
const parser = new Parser();

type SqlAnalysis = Readonly<{
	isComplex: boolean;
	hotelIds: readonly string[];
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

function collectHotelPredicateIds(value: unknown, skipUnionTail = false): readonly string[] {
	const hotelIds: string[] = [];
	const collect = (candidate: unknown): void => {
		if (Array.isArray(candidate)) {
			for (const item of candidate) collect(item);
			return;
		}
		if (!isRecord(candidate)) return;
		hotelIds.push(...hotelPredicateIds(candidate));
		for (const [key, child] of Object.entries(candidate)) {
			if (skipUnionTail && key === '_next') continue;
			collect(child);
		}
	};
	collect(value);
	return hotelIds;
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
	let isComplex = false;
	let hasUnsafeBoolean = false;
	let hasCartesianJoin = false;
	const referencedHotelIds: string[] = [];
	const unionBranchHotelIds: Array<readonly string[]> = [];

	visit(ast, (node) => {
		if (Array.isArray(node.with) && node.with.length > 0) isComplex = true;
		if (isRecord(node._next)) {
			isComplex = true;
			let branch: unknown = node;
			while (isRecord(branch)) {
				unionBranchHotelIds.push(collectHotelPredicateIds(branch, true));
				branch = branch._next;
			}
		}
		if (node.type === 'binary_expr' && typeof node.operator === 'string') {
			const operator = node.operator.toUpperCase();
			if (operator === 'OR' || operator === 'XOR') hasUnsafeBoolean = true;
		}
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

	if (!isComplex) return { isComplex: false, hotelIds: referencedHotelIds };
	if (hasCartesianJoin) throw new AgentQueryRejectedError('酒店数据查询不允许笛卡尔连接');
	if (hasUnsafeBoolean) {
		throw new AgentQueryRejectedError(
			'复杂酒店数据查询不允许 OR/XOR 条件，请使用 IN 明确限制酒店范围'
		);
	}
	const authorized = new Set(allowedHotelIds);
	if (
		referencedHotelIds.length === 0 ||
		referencedHotelIds.some((hotelId) => !authorized.has(hotelId)) ||
		unionBranchHotelIds.some(
			(branchHotelIds) =>
				branchHotelIds.length === 0 || branchHotelIds.some((hotelId) => !authorized.has(hotelId))
		)
	) {
		throw new AgentQueryRejectedError(
			'复杂酒店数据查询必须显式限制在当前账号的酒店范围内'
		);
	}
	return { isComplex: true, hotelIds: referencedHotelIds };
}
