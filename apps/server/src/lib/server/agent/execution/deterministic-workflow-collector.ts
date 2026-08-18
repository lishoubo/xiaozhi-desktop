import type { AgentPrincipal } from '@hotel-butler/api';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { randomUUID } from 'node:crypto';
import type { RuntimeEvent } from '../agent-runtime';
import {
	agentPromise,
	agentErrorRetryable,
	agentErrorType,
	agentFailureKind,
	AgentProtocolError,
	AgentUpstreamError,
	runAgentEffect
} from '../agent-effect';
import { HOTEL_DATA_SQL_TOOL_NAME } from '../hotel-data-mcp';
import { summarizeMcpResult } from '../mcp-observability';
import type { McpToolProvider } from '../mcp-tool-provider';
import type { JsonValue, ResolvedBusinessRequest } from './business-execution-state';

type ToolProviderPort = Pick<McpToolProvider, 'getTools'>;

export type WorkflowCollectionRequest = Readonly<{
	principal: AgentPrincipal;
	request: ResolvedBusinessRequest;
	signal: AbortSignal;
	emit(event: RuntimeEvent): Promise<void>;
}>;

export type WorkflowCollectionResult =
	| Readonly<{
			status: 'collected';
			strategy: 'deterministic';
			toolEvidence: readonly Readonly<{
				toolName: string;
				toolArgs: unknown;
				result: unknown;
			}>[];
	  }>
	| Readonly<{
			status: 'fallback';
			reason: 'agent_required' | 'tool_unavailable' | 'incompatible_tool_schema';
	  }>;

function slotString(slots: ResolvedBusinessRequest['slots'], name: string): string | null {
	const value = slots[name];
	return typeof value === 'string' && value.trim() ? value : null;
}

function schemaPropertyNames(schema: unknown): ReadonlySet<string> | null {
	if (typeof schema !== 'object' || schema === null) return null;
	const properties = Reflect.get(schema, 'properties') ?? Reflect.get(schema, 'shape');
	if (typeof properties !== 'object' || properties === null || Array.isArray(properties))
		return null;
	return new Set(Object.keys(properties));
}

function schemaAccepts(schema: unknown, args: Readonly<Record<string, unknown>>): boolean {
	if (typeof schema !== 'object' || schema === null) return false;
	const safeParse = Reflect.get(schema, 'safeParse');
	if (typeof safeParse === 'function') {
		const parsed: unknown = Reflect.apply(safeParse, schema, [args]);
		return typeof parsed === 'object' && parsed !== null && Reflect.get(parsed, 'success') === true;
	}
	const properties = schemaPropertyNames(schema);
	if (!properties || Object.keys(args).some((key) => !properties.has(key))) return false;
	const required = Reflect.get(schema, 'required');
	return (
		!Array.isArray(required) ||
		required.every((key) => typeof key === 'string' && Reflect.has(args, key))
	);
}

function optionalArgs(
	schema: unknown,
	values: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
	const properties = schemaPropertyNames(schema);
	if (!properties) return values;
	return Object.fromEntries(Object.entries(values).filter(([key]) => properties.has(key)));
}

function weatherArgs(
	tool: StructuredToolInterface,
	request: ResolvedBusinessRequest
): Readonly<Record<string, unknown>> | null {
	const location = slotString(request.slots, 'location');
	if (!location) return null;
	const candidates = [
		optionalArgs(tool.schema, {
			city_name: location,
			include: ['current', 'forecast', 'alerts', 'air_quality'],
			days: 1,
			detail: 'summary'
		}),
		optionalArgs(tool.schema, { location, days: 1 })
	];
	return candidates.find((candidate) => schemaAccepts(tool.schema, candidate)) ?? null;
}

function operatingSummaryArgs(
	tool: StructuredToolInterface,
	request: ResolvedBusinessRequest
): Readonly<Record<string, unknown>> | null {
	const hotel = slotString(request.slots, 'hotelReference');
	const range = request.slots.dateRange;
	if (!hotel || typeof range !== 'object' || range === null || Array.isArray(range)) return null;
	const start = Reflect.get(range, 'start');
	const end = Reflect.get(range, 'end');
	const metrics = slotString(request.slots, 'metrics');
	if (typeof start !== 'string' || typeof end !== 'string') return null;
	if (tool.name === HOTEL_DATA_SQL_TOOL_NAME) {
		if (
			!/^\d+$/.test(hotel) ||
			!/^\d{4}-\d{2}-\d{2}$/.test(start) ||
			!/^\d{4}-\d{2}-\d{2}$/.test(end)
		) {
			return null;
		}
		const dailyTrend = metrics === '按日经营趋势';
		return {
			database_id: 'server-configured',
			script: dailyTrend
				? `SELECT hotel_id, data_date, SUM(gmv) AS gmv, SUM(booking_amount) AS booking_amount, SUM(verified_amount) AS verified_amount, SUM(refund_amount) AS refund_amount, SUM(gmv_coupon_cnt) AS gmv_coupon_cnt, SUM(booking_coupon_cnt) AS booking_coupon_cnt, SUM(verified_coupon_cnt) AS verified_coupon_cnt, SUM(refund_coupon_cnt) AS refund_coupon_cnt, SUM(gmv_room_night) AS gmv_room_night, SUM(booking_room_night) AS booking_room_night, SUM(verified_room_night) AS verified_room_night, SUM(refund_room_night) AS refund_room_night, CASE WHEN SUM(verified_coupon_cnt) > 0 THEN SUM(verified_amount) / SUM(verified_coupon_cnt) ELSE NULL END AS verified_unit_price FROM fact_business_daily WHERE hotel_id = ${hotel} AND data_date BETWEEN '${start}' AND '${end}' AND product_type = 'ALL' GROUP BY hotel_id, data_date ORDER BY data_date ASC`
				: `SELECT hotel_id, MIN(data_date) AS period_start, MAX(data_date) AS period_end, SUM(gmv) AS gmv, SUM(booking_amount) AS booking_amount, SUM(verified_amount) AS verified_amount, SUM(refund_amount) AS refund_amount, SUM(gmv_coupon_cnt) AS gmv_coupon_cnt, SUM(booking_coupon_cnt) AS booking_coupon_cnt, SUM(verified_coupon_cnt) AS verified_coupon_cnt, SUM(refund_coupon_cnt) AS refund_coupon_cnt, SUM(gmv_room_night) AS gmv_room_night, SUM(booking_room_night) AS booking_room_night, SUM(verified_room_night) AS verified_room_night, SUM(refund_room_night) AS refund_room_night, CASE WHEN SUM(verified_coupon_cnt) > 0 THEN SUM(verified_amount) / SUM(verified_coupon_cnt) ELSE NULL END AS verified_unit_price FROM fact_business_daily WHERE hotel_id = ${hotel} AND data_date BETWEEN '${start}' AND '${end}' AND product_type = 'ALL' GROUP BY hotel_id`
		};
	}
	const question = `查询酒店 ${hotel} 在 ${start} 至 ${end} 的经营概览，仅返回营业收入、出租率、平均房价、RevPAR、间夜量等实际可用的聚合指标及口径。`;
	const candidates = ['question', 'query', 'prompt', 'input'].map((key) => ({ [key]: question }));
	return candidates.find((candidate) => schemaAccepts(tool.schema, candidate)) ?? null;
}

const RATE_SLOT_ALIASES = {
	hotelReference: [
		'hotelReference',
		'hotel_reference',
		'hotelId',
		'hotel_id',
		'hotelName',
		'hotel_name',
		'hotel',
		'propertyId',
		'property_id'
	],
	checkIn: ['checkIn', 'check_in', 'checkin', 'arrivalDate', 'arrival_date'],
	checkOut: ['checkOut', 'check_out', 'checkout', 'departureDate', 'departure_date'],
	guests: ['guests', 'guestCount', 'guest_count', 'adults'],
	currency: ['currency', 'currencyCode', 'currency_code']
} as const;

function rateArgs(
	tool: StructuredToolInterface,
	request: ResolvedBusinessRequest
): Readonly<Record<string, unknown>> | null {
	const properties = schemaPropertyNames(tool.schema);
	if (!properties) return null;
	const args: Record<string, JsonValue> = {};
	for (const [slot, aliases] of Object.entries(RATE_SLOT_ALIASES)) {
		const value = request.slots[slot];
		const key = aliases.find((alias) => properties.has(alias));
		if (!key || value === undefined) return null;
		args[key] = value;
	}
	return schemaAccepts(tool.schema, args) ? args : null;
}

function selectTool(
	tools: readonly StructuredToolInterface[],
	request: ResolvedBusinessRequest
): Readonly<{ tool: StructuredToolInterface; args: Readonly<Record<string, unknown>> }> | null {
	if (request.intent === 'weather_operations_advice') {
		const tool = tools.find((candidate) => candidate.name === 'get_weather_summary');
		const args = tool ? weatherArgs(tool, request) : null;
		return tool && args ? { tool, args } : null;
	}
	if (request.intent === 'hotel_operating_summary') {
		const tool = tools.find((candidate) => candidate.name === HOTEL_DATA_SQL_TOOL_NAME);
		const args = tool ? operatingSummaryArgs(tool, request) : null;
		return tool && args && schemaAccepts(tool.schema, args) ? { tool, args } : null;
	}
	if (request.intent === 'public_hotel_rates') {
		for (const tool of tools.filter((candidate) =>
			/rate|price|availability|room/i.test(candidate.name)
		)) {
			const args = rateArgs(tool, request);
			if (args) return { tool, args };
		}
	}
	return null;
}

function toolResultIsError(result: unknown): boolean {
	return (
		typeof result === 'object' &&
		result !== null &&
		(Reflect.get(result, 'isError') === true || Reflect.get(result, 'status') === 'error')
	);
}

export class DeterministicWorkflowCollector {
	constructor(private readonly tools: ToolProviderPort) {}

	async collect(input: WorkflowCollectionRequest): Promise<WorkflowCollectionResult> {
		if (
			input.request.intent === 'generic_hotel_data_query' ||
			(input.request.intent === 'hotel_operating_summary' &&
				Array.isArray(input.request.slots.hotelReference))
		) {
			return { status: 'fallback', reason: 'agent_required' };
		}
		const tools = await runAgentEffect(
			agentPromise({
				service: 'mcp',
				operation: 'load_tool_catalog',
				timeoutMs: 55_000,
				try: () => this.tools.getTools()
			}),
			input.signal
		);
		const selected = selectTool(tools, input.request);
		if (!selected) {
			if (input.request.intent === 'hotel_operating_summary') {
				throw new AgentProtocolError({
					operation: 'select_hotel_operating_tool',
					reason: 'Pinned hotel operating SQL tool is unavailable or incompatible'
				});
			}
			return {
				status: 'fallback',
				reason: tools.length === 0 ? 'tool_unavailable' : 'incompatible_tool_schema'
			};
		}
		const toolCallId = `${selected.tool.name}_${randomUUID()}`;
		await runAgentEffect(
			agentPromise({
				service: 'persistence',
				operation: 'publish_tool_started',
				timeoutMs: 10_000,
				try: () => input.emit({ type: 'tool_started', toolCallId, toolName: selected.tool.name })
			}),
			input.signal
		);
		await input.emit({ type: 'mcp_call_started', toolCallId, toolName: selected.tool.name });
		const callStartedAt = performance.now();
		let result: unknown;
		try {
			result = await runAgentEffect(
				agentPromise({
					service: 'mcp',
					operation: selected.tool.name,
					timeoutMs: 50_000,
					try: (signal) => selected.tool.invoke(selected.args, { signal })
				}),
				input.signal
			);
		} catch (error) {
			await input.emit({
				type: 'mcp_call_failed',
				toolCallId,
				toolName: selected.tool.name,
				durationMs: Math.max(0, Math.round(performance.now() - callStartedAt)),
				errorType: agentErrorType(error),
				failureKind: agentFailureKind(error),
				retryable: agentErrorRetryable(error)
			});
			throw error;
		}
		if (toolResultIsError(result)) {
			const error = new AgentUpstreamError({
				service: 'mcp',
				operation: selected.tool.name,
				kind: 'invalid_response'
			});
			await input.emit({
				type: 'mcp_call_failed',
				toolCallId,
				toolName: selected.tool.name,
				durationMs: Math.max(0, Math.round(performance.now() - callStartedAt)),
				errorType: agentErrorType(error),
				failureKind: agentFailureKind(error),
				retryable: agentErrorRetryable(error)
			});
			throw error;
		}
		await input.emit({
			type: 'mcp_call_completed',
			toolCallId,
			toolName: selected.tool.name,
			durationMs: Math.max(0, Math.round(performance.now() - callStartedAt)),
			resultSummary: summarizeMcpResult(result)
		});
		await runAgentEffect(
			agentPromise({
				service: 'persistence',
				operation: 'publish_tool_completed',
				timeoutMs: 10_000,
				try: () =>
					input.emit({
						type: 'tool_completed',
						toolCallId,
						toolName: selected.tool.name,
						summary: '工具调用已完成'
					})
			}),
			input.signal
		);
		return {
			status: 'collected',
			strategy: 'deterministic',
			toolEvidence: [{ toolName: selected.tool.name, toolArgs: selected.args, result }]
		};
	}
}
