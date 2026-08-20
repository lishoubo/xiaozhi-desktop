import type { StructuredToolInterface } from '@langchain/core/tools';
import type { JsonValue, ResolvedBusinessRequest } from '../business-execution-state';

export function slotString(slots: ResolvedBusinessRequest['slots'], name: string): string | null {
	const value = slots[name];
	return typeof value === 'string' && value.trim() ? value : null;
}

export function schemaPropertyNames(schema: unknown): ReadonlySet<string> | null {
	if (typeof schema !== 'object' || schema === null) return null;
	const properties = Reflect.get(schema, 'properties') ?? Reflect.get(schema, 'shape');
	if (typeof properties !== 'object' || properties === null || Array.isArray(properties))
		return null;
	return new Set(Object.keys(properties));
}

export function schemaAccepts(schema: unknown, args: Readonly<Record<string, unknown>>): boolean {
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

export function publicRateArgs(
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
