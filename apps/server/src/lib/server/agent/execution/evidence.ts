import { createHash, randomUUID } from 'node:crypto';
import type { AgentBusinessIntent } from '@hotel-butler/api';
import { compactHotelDataResult } from '../hotel-data-mcp';
import type { JsonValue, ResolvedBusinessRequest } from './business-execution-state';

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
	filtered: boolean;
	data: JsonValue;
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

function explicitHotelReference(value: unknown, depth = 0): string | null {
	if (depth > 6 || value === null || typeof value !== 'object') return null;
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = explicitHotelReference(item, depth + 1);
			if (found) return found;
		}
		return null;
	}
	for (const key of ['hotelReference', 'hotelId', 'hotel_id', 'hotelCode', 'hotel_code']) {
		const candidate = Reflect.get(value, key);
		if (typeof candidate === 'string' || typeof candidate === 'number') return String(candidate);
	}
	for (const item of Object.values(value)) {
		const found = explicitHotelReference(item, depth + 1);
		if (found) return found;
	}
	return null;
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
	const compacted = compactHotelDataResult(input.result);
	let data: unknown = compacted;
	try {
		data = JSON.parse(compacted.split('\n\n[DATA_RESULT_FILTERED]')[0] ?? compacted);
	} catch {
		// Bounded compacted text is valid evidence data.
	}
	const metrics = valueAt(input.request.slots, 'metrics');
	const requestedHotel = valueAt(input.request.slots, 'hotelReference');
	const observedHotel = explicitHotelReference(data);
	return {
		evidenceId: randomUUID(),
		source: sourceForIntent(input.request.intent),
		toolName: input.toolName,
		queryFingerprint: createHash('sha256')
			.update(JSON.stringify({ toolName: input.toolName, args: input.toolArgs }))
			.digest('hex'),
		scope: {
			hotelReference: observedHotel ?? (typeof requestedHotel === 'string' ? requestedHotel : null),
			period: periodFromRequest(input.request)
		},
		metrics: Array.isArray(metrics)
			? metrics.filter((metric): metric is string => typeof metric === 'string')
			: typeof metrics === 'string'
				? [metrics]
				: [],
		observedAt: input.observedAt ?? null,
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
	if (
		typeof requestedHotel === 'string' &&
		evidence.some(
			(item) => item.scope.hotelReference !== null && item.scope.hotelReference !== requestedHotel
		)
	) {
		return { status: 'rejected', reasonCode: 'evidence_scope_mismatch' };
	}
	const limitations = evidence.some((item) => item.filtered)
		? ['结果经过行数、字段或长度裁剪，不代表完整明细。']
		: [];
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
