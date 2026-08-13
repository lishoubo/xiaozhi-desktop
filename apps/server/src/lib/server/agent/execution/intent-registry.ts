import type { AgentBusinessIntent } from '@hotel-butler/api';
import type { McpCapability } from '../agent-config';

export type SlotDefinition = Readonly<{
	name: string;
	required: boolean;
	defaultValue?: string | number;
}>;

export type IntentDefinition = Readonly<{
	intent: AgentBusinessIntent;
	capability: McpCapability;
	workflowId: string;
	slots: readonly SlotDefinition[];
	maxToolCalls: number;
	allowSchemaDiscovery: boolean;
	allowEvidenceFollowUp: boolean;
}>;

const definitions = [
	{
		intent: 'weather_operations_advice',
		capability: 'weather',
		workflowId: 'weather_operations_advice.v1',
		slots: [
			{ name: 'location', required: true },
			{ name: 'date', required: true, defaultValue: 'today' }
		],
		maxToolCalls: 2,
		allowSchemaDiscovery: false,
		allowEvidenceFollowUp: true
	},
	{
		intent: 'hotel_operating_summary',
		capability: 'hotel_data',
		workflowId: 'hotel_operating_summary.v1',
		slots: [
			{ name: 'hotelReference', required: true },
			{ name: 'dateRange', required: true }
		],
		maxToolCalls: 4,
		allowSchemaDiscovery: true,
		allowEvidenceFollowUp: true
	},
	{
		intent: 'public_hotel_rates',
		capability: 'hotel_rates',
		workflowId: 'public_hotel_rates.v1',
		slots: [
			{ name: 'hotelReference', required: true },
			{ name: 'checkIn', required: true },
			{ name: 'checkOut', required: true },
			{ name: 'guests', required: true, defaultValue: 2 },
			{ name: 'currency', required: true, defaultValue: 'CNY' }
		],
		maxToolCalls: 2,
		allowSchemaDiscovery: false,
		allowEvidenceFollowUp: true
	},
	{
		intent: 'generic_hotel_data_query',
		capability: 'hotel_data',
		workflowId: 'generic_hotel_data_query.v1',
		slots: [
			{ name: 'hotelReference', required: true },
			{ name: 'dateRange', required: true },
			{ name: 'metrics', required: true }
		],
		maxToolCalls: 4,
		allowSchemaDiscovery: true,
		allowEvidenceFollowUp: true
	}
] as const satisfies readonly IntentDefinition[];

const byIntent = new Map<AgentBusinessIntent, IntentDefinition>(
	definitions.map((definition) => [definition.intent, definition])
);

export const quickActionIntent = {
	yesterday_operating_review: 'hotel_operating_summary',
	hotel_operating_data: 'hotel_operating_summary',
	public_hotel_rates: 'public_hotel_rates'
} as const;

export function getIntentDefinition(intent: AgentBusinessIntent): IntentDefinition {
	const definition = byIntent.get(intent);
	if (!definition) throw new Error(`Unknown Agent business intent: ${intent}`);
	return definition;
}

export function listIntentDefinitions(): readonly IntentDefinition[] {
	return definitions;
}
