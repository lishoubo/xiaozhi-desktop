import { createHash, randomUUID } from 'node:crypto';
import type { AgentBusinessIntent } from '@hotel-butler/api';
import { compactHotelDataResult } from '../hotel-data-mcp';
import type { JsonValue, ResolvedBusinessRequest } from './business-execution-state';
import {
	isEmptyHotelDataTable,
	operatingRowsMatchRequest,
	parseOperatingEvidenceRows
} from './deterministic-operating-answer';
import { HOTEL_DATA_SQL_TOOL_NAME } from '../hotel-data-mcp';
import {
	hotelDataDomainLabel,
	hotelDataDomainsForText,
	hotelDataTableSemantics,
	HOTEL_DATA_TABLES,
	type HotelDataDomain
} from '../hotel-data-business-catalog';
import { hotelDataSqlTableNames } from '../hotel-data-sql-policy';

export type HotelDataEvidenceProvenance = Readonly<{
	tables: readonly string[];
	domains: readonly HotelDataDomain[];
	grains: readonly string[];
	timeFields: readonly string[];
	units: readonly string[];
}>;

export type EvidenceEnvelope = Readonly<{
	evidenceId: string;
	source: 'aliyun_dms_mcp' | 'weather_mcp' | 'hotel_rates_mcp';
	toolName: string;
	queryFingerprint: string;
	scope: Readonly<{
		hotelReference: string | null;
		period: Readonly<{ start: string; end: string }> | null;
	}>;
	metrics: readonly string[];
	observedAt: string | null;
	parseQuality: EvidenceParseQuality;
	filtered: boolean;
	provenance: HotelDataEvidenceProvenance | null;
	data: JsonValue;
}>;

export type EvidenceParseQuality = 'structured' | 'json' | 'adapter' | 'unstructured';

export type ParsedEvidenceResult = Readonly<{
	quality: EvidenceParseQuality;
	data: unknown;
}>;

export type EvidenceAssessment =
	| Readonly<{ status: 'sufficient'; limitations: readonly string[] }>
	| Readonly<{ status: 'no_data' }>
	| Readonly<{ status: 'needs_more_data'; limitation: string }>
	| Readonly<{ status: 'inconclusive'; limitations: readonly string[] }>
	| Readonly<{ status: 'rejected'; reasonCode: string }>;

function jsonValue(value: unknown): JsonValue {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
	if (Array.isArray(value)) return value.map(jsonValue);
	if (typeof value === 'object') {
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item)]));
	}
	return String(value);
}

function textBlocks(value: unknown): string | null {
	if (!Array.isArray(value) || value.length === 0) return null;
	const texts: string[] = [];
	for (const block of value) {
		if (typeof block !== 'object' || block === null || Reflect.get(block, 'type') !== 'text') {
			return null;
		}
		const text = Reflect.get(block, 'text');
		if (typeof text !== 'string') return null;
		texts.push(text);
	}
	return texts.join('\n');
}

function contentValue(value: unknown): unknown {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
	const structured = Reflect.get(value, 'structuredContent');
	if (structured !== undefined) return structured;
	const artifact = Reflect.get(value, 'artifact');
	if (typeof artifact === 'object' && artifact !== null) {
		const artifactStructured = Reflect.get(artifact, 'structuredContent');
		if (artifactStructured !== undefined) return artifactStructured;
	}
	const content = Reflect.get(value, 'content');
	return content === undefined ? value : content;
}

function numberFrom(text: string, pattern: RegExp): number | undefined {
	const matched = text.match(pattern)?.[1];
	if (!matched) return undefined;
	const value = Number(matched);
	return Number.isFinite(value) ? value : undefined;
}

function adaptWeatherSummary(text: string): Readonly<Record<string, unknown>> | null {
	if (!/^# Weather Summary\b/m.test(text)) return null;
	const location = text
		.match(/^\*\*Location:\*\*\s*([^\n(]+?)(?:\s*\([^\n]*\))?\s*$/m)?.[1]
		?.trim();
	const timezone = text.match(/^\*\*Timezone:\*\*\s*([^\n]+)$/m)?.[1]?.trim();
	const observedAt = text.match(/^\*\*(?:Time|Observation Time):\*\*\s*([^\n]+)$/m)?.[1]?.trim();
	const currentTemperatureC = numberFrom(text, /^\*\*Temperature:\*\*\s*(-?\d+(?:\.\d+)?)°C\s*$/m);
	const maximumTemperatureC = numberFrom(
		text,
		/^\*\*(?:Today's Range|Temperature):\*\*\s*High\s*(-?\d+(?:\.\d+)?)°C/m
	);
	const minimumTemperatureC = numberFrom(
		text,
		/^\*\*(?:Today's Range|Temperature):\*\*.*?Low\s*(-?\d+(?:\.\d+)?)°C/m
	);
	const precipitationProbability = numberFrom(
		text,
		/^\*\*Precipitation Chance:\*\*\s*(\d+(?:\.\d+)?)%/m
	);
	return {
		format: 'weather_summary_v1',
		...(location ? { location } : {}),
		...(timezone ? { timezone } : {}),
		...(observedAt ? { observedAt } : {}),
		...(currentTemperatureC === undefined ? {} : { currentTemperatureC }),
		...(maximumTemperatureC === undefined ? {} : { maximumTemperatureC }),
		...(minimumTemperatureC === undefined ? {} : { minimumTemperatureC }),
		...(precipitationProbability === undefined ? {} : { precipitationProbability }),
		rawText: text
	};
}

export function parseEvidenceResult(toolName: string, result: unknown): ParsedEvidenceResult {
	const value = contentValue(result);
	if (typeof result === 'object' && result !== null) {
		const structured = Reflect.get(result, 'structuredContent');
		if (structured !== undefined) return { quality: 'structured', data: structured };
	}
	const text = typeof value === 'string' ? value : textBlocks(value);
	if (text !== null) {
		try {
			return { quality: 'json', data: JSON.parse(text) };
		} catch {
			const adapted = toolName === 'get_weather_summary' ? adaptWeatherSummary(text) : null;
			return adapted
				? { quality: 'adapter', data: adapted }
				: { quality: 'unstructured', data: text };
		}
	}
	return { quality: 'structured', data: value };
}

function valueAt(slots: ResolvedBusinessRequest['slots'], name: string): JsonValue | undefined {
	return slots[name];
}

function periodFromRequest(request: ResolvedBusinessRequest): EvidenceEnvelope['scope']['period'] {
	const range = valueAt(request.slots, 'dateRange');
	if (
		range &&
		typeof range === 'object' &&
		!Array.isArray(range) &&
		'start' in range &&
		'end' in range
	) {
		const start = range.start;
		const end = range.end;
		return typeof start === 'string' && typeof end === 'string' ? { start, end } : null;
	}
	const date = valueAt(request.slots, 'date');
	return typeof date === 'string' ? { start: date, end: date } : null;
}

function sourceForIntent(intent: AgentBusinessIntent): EvidenceEnvelope['source'] {
	if (intent === 'weather_operations_advice') return 'weather_mcp';
	if (intent === 'public_hotel_rates') return 'hotel_rates_mcp';
	return 'aliyun_dms_mcp';
}

function scriptFromToolArgs(toolArgs: unknown, depth = 0): string | null {
	if (depth > 4) return null;
	if (typeof toolArgs === 'string') {
		try {
			return scriptFromToolArgs(JSON.parse(toolArgs), depth + 1);
		} catch {
			return null;
		}
	}
	if (typeof toolArgs !== 'object' || toolArgs === null) return null;
	const script = Reflect.get(toolArgs, 'script');
	if (typeof script === 'string') return script;
	return scriptFromToolArgs(Reflect.get(toolArgs, 'args'), depth + 1);
}

function resultFieldNames(value: unknown, depth = 0): readonly string[] {
	if (depth > 8 || value === null) return [];
	if (typeof value === 'string') {
		const markdownHeader = value
			.split('\n')
			.map((line) => line.trim())
			.find((line) => line.startsWith('|') && line.endsWith('|'));
		if (markdownHeader) {
			return markdownHeader
				.slice(1, -1)
				.split('|')
				.map((field) => field.trim())
				.filter((field) => /^[a-z][a-z0-9_]*$/i.test(field));
		}
		try {
			return resultFieldNames(JSON.parse(value), depth + 1);
		} catch {
			return [];
		}
	}
	if (Array.isArray(value)) {
		return [...new Set(value.flatMap((item) => resultFieldNames(item, depth + 1)))];
	}
	if (typeof value !== 'object') return [];
	return [
		...new Set([
			...Object.keys(value).filter((field) => /^[a-z][a-z0-9_]*$/i.test(field)),
			...Object.values(value).flatMap((item) => resultFieldNames(item, depth + 1))
		])
	];
}

function sqlProvenance(
	toolName: string,
	toolArgs: unknown,
	data: unknown
): HotelDataEvidenceProvenance | null {
	if (toolName !== HOTEL_DATA_SQL_TOOL_NAME) return null;
	const script = scriptFromToolArgs(toolArgs);
	let tableNames: readonly string[];
	if (script) {
		try {
			tableNames = hotelDataSqlTableNames(script);
		} catch {
			tableNames = [];
		}
	} else {
		tableNames = [];
	}
	const exactTables = tableNames.flatMap((name) => {
		const semantics = hotelDataTableSemantics(name);
		return semantics ? [semantics] : [];
	});
	const fieldNames = resultFieldNames(data);
	const inferredTables = fieldNames.flatMap((field) => {
		const owners = HOTEL_DATA_TABLES.filter((item) => item.columns.includes(field));
		return owners.length === 1 ? owners : [];
	});
	const inferredDomains = fieldNames.flatMap((field) => {
		const owners = HOTEL_DATA_TABLES.filter((item) => item.columns.includes(field));
		const domains = [...new Set(owners.map((item) => item.domain))];
		return domains.length === 1 ? domains : [];
	});
	const tables = [
		...new Map([...exactTables, ...inferredTables].map((item) => [item.name, item])).values()
	];
	if (tables.length === 0 && inferredDomains.length === 0) return null;
	return {
		tables: tables.map((item) => item.name),
		domains: [...new Set([...tables.map((item) => item.domain), ...inferredDomains])],
		grains: [...new Set(tables.map((item) => item.grain))],
		timeFields: [...new Set(tables.flatMap((item) => (item.timeField ? [item.timeField] : [])))],
		units: [...new Set(tables.flatMap((item) => item.units))]
	};
}

function explicitHotelReferences(value: unknown, depth = 0): readonly string[] {
	if (depth > 6 || value === null || typeof value !== 'object') return [];
	if (Array.isArray(value)) {
		return [...new Set(value.flatMap((item) => explicitHotelReferences(item, depth + 1)))];
	}
	const direct: string[] = [];
	for (const key of ['hotelReference', 'hotelId', 'hotel_id', 'hotelCode', 'hotel_code']) {
		const candidate = Reflect.get(value, key);
		if (typeof candidate === 'string' || typeof candidate === 'number')
			direct.push(String(candidate));
	}
	return [
		...new Set([
			...direct,
			...Object.values(value).flatMap((item) => explicitHotelReferences(item, depth + 1))
		])
	];
}

function structuredHotelReferences(value: unknown, depth = 0): readonly string[] | null {
	if (depth > 6 || value === null || typeof value !== 'object') return null;
	if (Array.isArray(value)) {
		if (
			value.length === 0 ||
			!value.every((item) => typeof item === 'object' && item !== null && !Array.isArray(item))
		) {
			return null;
		}
		const rowScopes = value.map((row) => explicitHotelReferences(row, 6));
		if (rowScopes.some((scope) => scope.length === 0)) return null;
		return [...new Set(rowScopes.flat())];
	}
	const collections = ['rows', 'data', 'records', 'items', 'result'].flatMap((key) => {
		const candidate = Reflect.get(value, key);
		return candidate === undefined ? [] : [candidate];
	});
	if (collections.length > 0) {
		const scopes = collections.map((collection) =>
			structuredHotelReferences(collection, depth + 1)
		);
		if (scopes.some((scope) => scope === null)) return null;
		return [...new Set(scopes.flatMap((scope) => scope ?? []))];
	}
	const direct = explicitHotelReferences(value, 6);
	return direct.length > 0 ? direct : null;
}

export function normalizeEvidence(
	input: Readonly<{
		request: ResolvedBusinessRequest;
		toolName: string;
		toolArgs: unknown;
		result: unknown;
		observedAt?: string | null;
	}>
): EvidenceEnvelope {
	const parsed = parseEvidenceResult(input.toolName, input.result);
	const compacted = compactHotelDataResult(parsed.data);
	let data: unknown = compacted;
	try {
		data = JSON.parse(compacted.split('\n\n[DATA_RESULT_FILTERED]')[0] ?? compacted);
	} catch {
		// Bounded compacted text is valid evidence data.
	}
	const metrics = valueAt(input.request.slots, 'metrics');
	const requestedHotel = valueAt(input.request.slots, 'hotelReference');
	const operatingRows = parseOperatingEvidenceRows(data);
	const observedHotelIds = [
		...new Set(
			operatingRows
				.map((row) => row.hotel_id)
				.filter((value): value is string => typeof value === 'string' && value.length > 0)
		)
	];
	const observedDates = operatingRows
		.map((row) => row.data_date)
		.filter((value): value is string => /^\d{4}-\d{2}-\d{2}$/.test(value))
		.sort();
	const explicitHotelIds = structuredHotelReferences(data) ?? [];
	const observedHotel = [...new Set([...observedHotelIds, ...explicitHotelIds])].join(',') || null;
	const observedPeriod =
		observedDates.length > 0
			? { start: observedDates[0] ?? '', end: observedDates.at(-1) ?? '' }
			: null;
	return {
		evidenceId: randomUUID(),
		source: sourceForIntent(input.request.intent),
		toolName: input.toolName,
		queryFingerprint: createHash('sha256')
			.update(JSON.stringify({ toolName: input.toolName, args: input.toolArgs }))
			.digest('hex'),
		scope: {
			hotelReference: observedHotel ?? (typeof requestedHotel === 'string' ? requestedHotel : null),
			period: observedPeriod ?? periodFromRequest(input.request)
		},
		metrics: Array.isArray(metrics)
			? metrics.filter((metric): metric is string => typeof metric === 'string')
			: typeof metrics === 'string'
				? [metrics]
				: [],
		observedAt: input.observedAt ?? null,
		parseQuality: parsed.quality,
		filtered: compacted.includes('[DATA_RESULT_FILTERED]'),
		provenance: sqlProvenance(input.toolName, input.toolArgs, data),
		data: jsonValue(data)
	};
}

function emptyData(data: JsonValue): boolean {
	if (data === null || data === '') return true;
	if (Array.isArray(data)) return data.length === 0;
	if (typeof data === 'object') return Object.keys(data).length === 0;
	return false;
}

export function assessEvidence(
	request: ResolvedBusinessRequest,
	evidence: readonly EvidenceEnvelope[],
	followUpUsed: boolean
): EvidenceAssessment {
	const hotelQueryEvidence = evidence.filter(
		(item) => item.source === 'aliyun_dms_mcp' && item.toolName === HOTEL_DATA_SQL_TOOL_NAME
	);
	if (
		hotelQueryEvidence.length > 0 &&
		hotelQueryEvidence.every((item) => emptyData(item.data) || isEmptyHotelDataTable(item.data))
	) {
		if (request.intent === 'generic_hotel_data_query' && !followUpUsed) {
			return {
				status: 'needs_more_data',
				limitation: '目标业务数据为空，需核对最近完整业务日和同步状态。'
			};
		}
		return { status: 'no_data' };
	}
	if (evidence.length === 0 || evidence.every((item) => emptyData(item.data))) {
		return followUpUsed
			? { status: 'inconclusive', limitations: ['数据源未返回可验证数据。'] }
			: { status: 'needs_more_data', limitation: '数据源未返回可验证数据。' };
	}
	const requestedHotel = valueAt(request.slots, 'hotelReference');
	const requestedPeriod = periodFromRequest(request);
	if (
		request.intent === 'hotel_operating_summary' &&
		evidence.some((item) => {
			const rows = parseOperatingEvidenceRows(item.data);
			return rows.length > 0 && !operatingRowsMatchRequest(rows, request);
		})
	) {
		return { status: 'rejected', reasonCode: 'evidence_scope_mismatch' };
	}
	if (
		typeof requestedHotel === 'string' &&
		evidence.some(
			(item) => item.scope.hotelReference !== null && item.scope.hotelReference !== requestedHotel
		)
	) {
		return { status: 'rejected', reasonCode: 'evidence_scope_mismatch' };
	}
	if (
		Array.isArray(requestedHotel) &&
		requestedHotel.every((hotel): hotel is string => typeof hotel === 'string') &&
		evidence.some((item) => {
			if (item.scope.hotelReference === null) return true;
			const allowed = new Set(requestedHotel);
			return item.scope.hotelReference.split(',').some((hotel) => !allowed.has(hotel));
		})
	) {
		return { status: 'rejected', reasonCode: 'evidence_scope_mismatch' };
	}
	if (
		requestedPeriod &&
		evidence.some(
			(item) =>
				item.scope.period !== null &&
				(item.scope.period.start < requestedPeriod.start ||
					item.scope.period.end > requestedPeriod.end)
		)
	) {
		return { status: 'rejected', reasonCode: 'evidence_scope_mismatch' };
	}
	if (
		(request.intent === 'generic_hotel_data_query' ||
			request.intent === 'hotel_operating_summary') &&
		hotelQueryEvidence.length === 0
	) {
		const limitation = '尚未成功执行酒店经营数据查询。';
		return followUpUsed
			? { status: 'inconclusive', limitations: [limitation] }
			: { status: 'needs_more_data', limitation };
	}
	if (request.intent === 'generic_hotel_data_query') {
		const metrics = valueAt(request.slots, 'metrics');
		const metricText = Array.isArray(metrics)
			? metrics.filter((item): item is string => typeof item === 'string').join(' ')
			: typeof metrics === 'string'
				? metrics
				: '';
		const requiredDomains = hotelDataDomainsForText(metricText);
		const provenanceAvailable = hotelQueryEvidence.some(
			(item) => (item.provenance?.domains.length ?? 0) > 0
		);
		if (requiredDomains.length > 0 && provenanceAvailable) {
			const coveredDomains = new Set(
				hotelQueryEvidence
					.filter((item) => !emptyData(item.data) && !isEmptyHotelDataTable(item.data))
					.flatMap((item) => item.provenance?.domains ?? [])
			);
			const missing = requiredDomains.filter((domain) => !coveredDomains.has(domain));
			if (missing.length > 0) {
				const limitation = `尚缺少以下业务域的可验证数据：${missing
					.map(hotelDataDomainLabel)
					.join('、')}。`;
				return followUpUsed
					? { status: 'inconclusive', limitations: [limitation] }
					: { status: 'needs_more_data', limitation };
			}
		}
	}
	const limitations = [
		...(evidence.some((item) => item.filtered)
			? ['结果经过行数、字段或长度裁剪，不代表完整明细。']
			: []),
		...(evidence.some((item) => item.parseQuality === 'unstructured')
			? ['数据源仅提供非结构化文本，字段级校验能力有限。']
			: [])
	];
	if (
		(request.intent === 'weather_operations_advice' || request.intent === 'public_hotel_rates') &&
		evidence.every((item) => item.observedAt === null)
	) {
		return followUpUsed
			? { status: 'inconclusive', limitations: [...limitations, '数据缺少采集时间。'] }
			: { status: 'needs_more_data', limitation: '数据缺少采集时间。' };
	}
	return { status: 'sufficient', limitations };
}
