import type { GenerativeUiSpec } from '@hotel-butler/api';
import { validateHotelUi } from '../hotel-ui-validator';
import type { EvidenceRecord, ResolvedBusinessRequest } from './business-execution-state';

type TableRow = Readonly<Record<string, string>>;
const TEXT_BLOCK_PREFIX = '[{"type":"text","text":"';

const columns = [
	['data_date', '日期'],
	['gmv', '成交金额'],
	['booking_amount', '预约金额'],
	['verified_amount', '核销金额'],
	['refund_amount', '退款金额'],
	['verified_unit_price', '核销单价']
] as const;

function textFromEvidence(value: unknown, depth = 0): string | null {
	if (depth > 5) return null;
	if (typeof value === 'string') {
		try {
			return textFromEvidence(JSON.parse(value), depth + 1) ?? value;
		} catch {
			if (value.startsWith(TEXT_BLOCK_PREFIX)) {
				let encoded = value.slice(TEXT_BLOCK_PREFIX.length).split('…[值已截断]')[0] ?? '';
				if (encoded.endsWith('\\')) encoded = encoded.slice(0, -1);
				try {
					return JSON.parse(`"${encoded}"`);
				} catch {
					return encoded.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
				}
			}
			return value;
		}
	}
	if (Array.isArray(value)) {
		const texts = value
			.map((item) => textFromEvidence(item, depth + 1))
			.filter((item): item is string => item !== null);
		return texts.length ? texts.join('\n') : null;
	}
	if (typeof value !== 'object' || value === null) return null;
	const text = Reflect.get(value, 'text');
	if (typeof text === 'string') return text;
	return textFromEvidence(Reflect.get(value, 'data'), depth + 1);
}

function markdownTable(text: string): Readonly<{ valid: boolean; rows: readonly TableRow[] }> {
	const tableLines = text
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.startsWith('|') && line.endsWith('|'));
	if (tableLines.length < 2) return { valid: false, rows: [] };
	const cells = (line: string): string[] =>
		line
			.slice(1, -1)
			.split('|')
			.map((cell) => cell.trim());
	const headers = cells(tableLines[0] ?? '');
	const separator = cells(tableLines[1] ?? '');
	if (
		headers.length === 0 ||
		separator.length !== headers.length ||
		!separator.every((cell) => /^:?-{3,}:?$/.test(cell))
	) {
		return { valid: false, rows: [] };
	}
	return {
		valid: true,
		rows: tableLines.slice(2).flatMap((line) => {
			const values = cells(line);
			if (values.length !== headers.length) return [];
			return [Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))];
		})
	};
}

export function parseOperatingEvidenceRows(value: unknown): readonly TableRow[] {
	const text = textFromEvidence(value);
	return text ? markdownTable(text).rows : [];
}

export function isEmptyHotelDataTable(value: unknown): boolean {
	const text = textFromEvidence(value);
	if (!text) return false;
	const table = markdownTable(text);
	return table.valid && table.rows.length === 0;
}

function requestedRange(
	request: ResolvedBusinessRequest
): Readonly<{ start: string; end: string }> | null {
	const range = request.slots.dateRange;
	if (typeof range !== 'object' || range === null || Array.isArray(range)) return null;
	const start = Reflect.get(range, 'start');
	const end = Reflect.get(range, 'end');
	return typeof start === 'string' && typeof end === 'string' ? { start, end } : null;
}

export function operatingRowsMatchRequest(
	rows: readonly TableRow[],
	request: ResolvedBusinessRequest
): boolean {
	if (rows.length === 0) return false;
	const hotel = request.slots.hotelReference;
	if (typeof hotel === 'string' && !rows.every((row) => row.hotel_id === hotel)) return false;
	if (
		Array.isArray(hotel) &&
		hotel.every((item): item is string => typeof item === 'string') &&
		!rows.every((row) => typeof row.hotel_id === 'string' && hotel.includes(row.hotel_id))
	) {
		return false;
	}
	const range = requestedRange(request);
	if (!range) return true;
	if (rows.some((row) => 'data_date' in row)) {
		return rows.every(
			(row) =>
				/^\d{4}-\d{2}-\d{2}$/.test(row.data_date ?? '') &&
				(row.data_date ?? '') >= range.start &&
				(row.data_date ?? '') <= range.end
		);
	}
	if (rows.some((row) => 'period_start' in row || 'period_end' in row)) {
		return rows.every((row) => {
			const start = row.period_start ?? '';
			const end = row.period_end ?? '';
			return (
				/^\d{4}-\d{2}-\d{2}$/.test(start) &&
				/^\d{4}-\d{2}-\d{2}$/.test(end) &&
				start <= end &&
				start >= range.start &&
				end <= range.end
			);
		});
	}
	return false;
}

function finiteNumber(value: string | undefined): number | null {
	if (!value?.trim()) return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function period(request: ResolvedBusinessRequest): string {
	const range = request.slots.dateRange;
	if (typeof range !== 'object' || range === null || Array.isArray(range)) return '当前查询期间';
	const start = Reflect.get(range, 'start');
	const end = Reflect.get(range, 'end');
	return typeof start === 'string' && typeof end === 'string'
		? `${start} 至 ${end}`
		: '当前查询期间';
}

function total(rows: readonly TableRow[], key: string): number {
	return rows.reduce((sum, row) => sum + (finiteNumber(row[key]) ?? 0), 0);
}

function money(value: number): string {
	return new Intl.NumberFormat('zh-CN', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	}).format(value);
}

export function buildDeterministicOperatingAnswer(
	request: ResolvedBusinessRequest,
	evidence: readonly EvidenceRecord[]
): Readonly<{ content: string; ui: GenerativeUiSpec }> | null {
	if (request.intent !== 'hotel_operating_summary') return null;
	if (Array.isArray(request.slots.hotelReference) && request.slots.hotelReference.length > 1)
		return null;
	const source = evidence.find((item) => item.source === 'aliyun_dms_mcp');
	const rows = source ? parseOperatingEvidenceRows(source.data) : [];
	if (!operatingRowsMatchRequest(rows, request)) return null;

	const availableColumns = columns.filter(([key]) => rows.some((row) => key in row));
	if (availableColumns.length === 0) return null;
	const detailRows = rows.map((row) =>
		availableColumns.map(([key]) => {
			if (key === 'data_date') return row[key] ?? '';
			return finiteNumber(row[key]);
		})
	);
	const usableMetric = (key: string): boolean =>
		rows.every((row) => key in row && finiteNumber(row[key]) !== null);
	const gmvUsable = usableMetric('gmv');
	const verifiedUsable = usableMetric('verified_amount');
	const trendData = rows.flatMap((row) => {
		const date = row.data_date;
		const value = finiteNumber(row.gmv);
		if (!gmvUsable || !date || value === null) return [];
		const comparison = finiteNumber(row.verified_amount);
		return [
			{
				label: date.slice(5),
				value,
				...(!verifiedUsable || comparison === null ? {} : { comparison })
			}
		];
	});
	const showTrend = request.slots.metrics === '按日经营趋势' && trendData.length >= 2;
	const elements: GenerativeUiSpec['elements'] = {
		root: {
			type: showTrend ? 'Stack' : 'Card',
			props: {},
			children: showTrend ? ['trend', 'detail'] : ['detail'],
			visible: true
		},
		...(showTrend
			? {
					trend: {
						type: 'HotelLineChart',
						props: {
							title: '近 7 日经营趋势',
							description: period(request),
							data: trendData,
							valueLabel: '成交金额',
							...(verifiedUsable ? { comparisonLabel: '核销金额' } : {}),
							unit: '元',
							source: 'RMS 经营数据'
						},
						children: [],
						visible: true
					}
				}
			: {}),
		detail: {
			type: 'Table',
			props: {
				columns: availableColumns.map(([, label]) => label),
				rows: detailRows
			},
			children: [],
			visible: true
		}
	};
	const gmv = total(rows, 'gmv');
	const booking = total(rows, 'booking_amount');
	const verified = total(rows, 'verified_amount');
	const refund = total(rows, 'refund_amount');
	const summaries = [
		gmvUsable ? `成交金额合计 ${money(gmv)} 元` : '',
		usableMetric('booking_amount') ? `预约金额 ${money(booking)} 元` : '',
		verifiedUsable ? `核销金额 ${money(verified)} 元` : '',
		usableMetric('refund_amount') ? `退款金额 ${money(refund)} 元` : ''
	].filter(Boolean);
	if (summaries.length === 0) return null;
	const peak = rows.reduce<TableRow | null>((selected, row) => {
		if (!selected) return row;
		return (finiteNumber(row.gmv) ?? Number.NEGATIVE_INFINITY) >
			(finiteNumber(selected.gmv) ?? Number.NEGATIVE_INFINITY)
			? row
			: selected;
	}, null);
	const filtered =
		typeof source?.data === 'object' &&
		source.data !== null &&
		Reflect.get(source.data, 'filtered') === true;
	const unstructured =
		typeof source?.data === 'object' &&
		source.data !== null &&
		Reflect.get(source.data, 'parseQuality') === 'unstructured';
	return {
		content: [
			`${period(request)}${filtered ? '（已展示数据）' : ''}：${summaries.join('，')}。`,
			gmvUsable && peak?.data_date
				? `成交金额高点出现在 ${peak.data_date}，为 ${money(finiteNumber(peak.gmv) ?? 0)} 元。`
				: '',
			filtered ? '结果经过行数、字段或长度裁剪，不代表完整明细。' : '',
			unstructured ? '数据源以表格文本返回，已按可识别字段校验和汇总。' : '',
			'数据来源：RMS 经营数据。'
		]
			.filter(Boolean)
			.join('\n\n'),
		ui: validateHotelUi({ root: 'root', state: {}, elements })
	};
}
