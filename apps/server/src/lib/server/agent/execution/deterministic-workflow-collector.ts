import type { AgentPrincipal } from '@hotel-butler/api';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { randomUUID } from 'node:crypto';
import type { RuntimeEvent } from '../agent-runtime';
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
	if (typeof start !== 'string' || typeof end !== 'string') return null;
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
		const tool = tools.find((candidate) => candidate.name === 'query_hotel_operating_data');
		const args = tool ? operatingSummaryArgs(tool, request) : null;
		return tool && args ? { tool, args } : null;
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
		if (input.request.intent === 'generic_hotel_data_query') {
			return { status: 'fallback', reason: 'agent_required' };
		}
		input.signal.throwIfAborted();
		const tools = await this.tools.getTools();
		input.signal.throwIfAborted();
		const selected = selectTool(tools, input.request);
		if (!selected) {
			return {
				status: 'fallback',
				reason: tools.length === 0 ? 'tool_unavailable' : 'incompatible_tool_schema'
			};
		}
		const toolCallId = `${selected.tool.name}_${randomUUID()}`;
		await input.emit({ type: 'tool_started', toolCallId, toolName: selected.tool.name });
		const result: unknown = await selected.tool.invoke(selected.args, { signal: input.signal });
		input.signal.throwIfAborted();
		if (toolResultIsError(result)) {
			throw new Error(`${selected.tool.name} MCP tool returned an error`);
		}
		await input.emit({
			type: 'tool_completed',
			toolCallId,
			toolName: selected.tool.name,
			summary: '工具调用已完成'
		});
		return {
			status: 'collected',
			strategy: 'deterministic',
			toolEvidence: [{ toolName: selected.tool.name, toolArgs: selected.args, result }]
		};
	}
}
