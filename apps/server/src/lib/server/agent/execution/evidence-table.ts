export type EvidenceCell = string | number | boolean | null;

export type EvidenceTable = Readonly<{
	columns: readonly string[];
	rows: readonly Readonly<Record<string, EvidenceCell>>[];
}>;

const TEXT_BLOCK_PREFIX = '[{"type":"text","text":"';

function cell(value: unknown): EvidenceCell {
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
	return serialized === undefined
		? String(value)
		: serialized.length > 500
			? `${serialized.slice(0, 500)}…`
			: serialized;
}

function cells(line: string): string[] {
	return line
		.slice(1, -1)
		.split('|')
		.map((item) => item.trim());
}

function markdownTable(text: string): EvidenceTable | null {
	const lines = text.split('\n').map((line) => line.trim());
	for (let index = 0; index < lines.length - 1; index += 1) {
		const header = lines[index] ?? '';
		const separatorLine = lines[index + 1] ?? '';
		if (!header.startsWith('|') || !header.endsWith('|')) continue;
		if (!separatorLine.startsWith('|') || !separatorLine.endsWith('|')) continue;
		const columns = cells(header);
		const separator = cells(separatorLine);
		if (
			columns.length === 0 ||
			separator.length !== columns.length ||
			!separator.every((item) => /^:?-{3,}:?$/.test(item))
		) {
			continue;
		}
		const rows: Record<string, EvidenceCell>[] = [];
		for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
			const line = lines[rowIndex] ?? '';
			if (!line.startsWith('|') || !line.endsWith('|')) break;
			const values = cells(line);
			if (values.length !== columns.length) break;
			rows.push(
				Object.fromEntries(columns.map((column, valueIndex) => [column, values[valueIndex] ?? '']))
			);
		}
		return { columns, rows };
	}
	return null;
}

function recordTable(records: readonly Readonly<Record<string, unknown>>[]): EvidenceTable {
	const columns = [...new Set(records.flatMap((record) => Object.keys(record)))];
	return {
		columns,
		rows: records.map((record) =>
			Object.fromEntries(columns.map((column) => [column, cell(record[column])]))
		)
	};
}

function matrixTable(value: Readonly<Record<string, unknown>>): EvidenceTable | null {
	const columns = value.columns;
	const rows = value.rows;
	if (!Array.isArray(columns) || !columns.every((column) => typeof column === 'string'))
		return null;
	if (!Array.isArray(rows) || !rows.every((row) => Array.isArray(row))) return null;
	return {
		columns,
		rows: rows.map((row) =>
			Object.fromEntries(columns.map((column, index) => [column, cell(row[index])]))
		)
	};
}

export function parseEvidenceTable(value: unknown, depth = 0): EvidenceTable | null {
	if (depth > 8 || value === null || value === undefined) return null;
	if (typeof value === 'number' || typeof value === 'boolean') {
		return { columns: ['查询结果'], rows: [{ 查询结果: value }] };
	}
	if (typeof value === 'string') {
		if (value.startsWith(TEXT_BLOCK_PREFIX)) {
			let encoded = value.slice(TEXT_BLOCK_PREFIX.length).split('…[值已截断]')[0] ?? '';
			if (encoded.endsWith('\\')) encoded = encoded.slice(0, -1);
			try {
				return parseEvidenceTable(JSON.parse(`"${encoded}"`), depth + 1);
			} catch {
				return parseEvidenceTable(
					encoded.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\'),
					depth + 1
				);
			}
		}
		try {
			return parseEvidenceTable(JSON.parse(value), depth + 1) ?? markdownTable(value);
		} catch {
			return (
				markdownTable(value) ??
				(value.trim() ? { columns: ['查询结果'], rows: [{ 查询结果: value.trim() }] } : null)
			);
		}
	}
	if (Array.isArray(value)) {
		const textBlocks = value.flatMap((item) => {
			if (typeof item !== 'object' || item === null || Reflect.get(item, 'type') !== 'text')
				return [];
			const text = Reflect.get(item, 'text');
			return typeof text === 'string' ? [text] : [];
		});
		if (textBlocks.length === value.length && textBlocks.length > 0) {
			return parseEvidenceTable(textBlocks.join('\n'), depth + 1);
		}
		if (value.every((item) => typeof item === 'object' && item !== null && !Array.isArray(item))) {
			return recordTable(value.map((item) => Object.fromEntries(Object.entries(item))));
		}
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
				rows: value.map((item) => ({ 查询结果: cell(item) }))
			};
		}
		return null;
	}
	if (typeof value !== 'object') return null;
	const record = Object.fromEntries(Object.entries(value));
	const matrix = matrixTable(record);
	if (matrix) return matrix;
	for (const key of [
		'structuredContent',
		'content',
		'data',
		'rows',
		'records',
		'items',
		'result'
	]) {
		if (!(key in record)) continue;
		const nested = parseEvidenceTable(record[key], depth + 1);
		if (nested) return nested;
		if (key === 'rows' && Array.isArray(record[key]) && record[key].length === 0) {
			return { columns: [], rows: [] };
		}
	}
	if ('artifact' in record) {
		const nested = parseEvidenceTable(record.artifact, depth + 1);
		if (nested) return nested;
	}
	return recordTable([record]);
}

export function rowValue(
	row: Readonly<Record<string, EvidenceCell>>,
	aliases: readonly string[]
): EvidenceCell | undefined {
	const allowed = new Set(aliases.map((alias) => alias.toLowerCase()));
	const matched = Object.entries(row).find(([key]) => allowed.has(key.toLowerCase()));
	return matched?.[1];
}

export function rowString(
	row: Readonly<Record<string, EvidenceCell>>,
	aliases: readonly string[]
): string | null {
	const value = rowValue(row, aliases);
	return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : null;
}
