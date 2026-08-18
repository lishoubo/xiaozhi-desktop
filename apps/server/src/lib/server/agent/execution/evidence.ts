import { createHash, randomUUID } from 'node:crypto';
import type { AgentBusinessIntent } from '@hotel-butler/api';
import { compactHotelDataResult } from '../hotel-data-mcp';
import type { JsonValue, ResolvedBusinessRequest } from './business-execution-state';
import {
	operatingRowsMatchRequest,
	parseOperatingEvidenceRows
} from './deterministic-operating-answer';

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
	data: JsonValue;
}>;

export type EvidenceParseQuality = 'structured' | 'json' | 'adapter' | 'unstructured';

export type ParsedEvidenceResult = Readonly<{
	quality: EvidenceParseQuality;
	data: unknown;
}>;

export type EvidenceAssessment =
	| Readonly<{ status: 'sufficient'; limitations: readonly string[] }>
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
		const scopes = collections.map((collection) => structuredHotelReferences(collection, depth + 1));
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
