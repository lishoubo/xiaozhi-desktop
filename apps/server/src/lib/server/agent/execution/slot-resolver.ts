import { randomUUID } from 'node:crypto';
import type { AgentBusinessIntent, AgentPendingClarification } from '@hotel-butler/api';
import type { IntentDefinition } from './intent-registry';
import type {
	JsonValue,
	ResolvedBusinessRequest,
	SlotCollection,
	SlotState
} from './business-execution-state';

export type HotelCandidate = Readonly<{
	id: string;
	label: string;
	match: 'exact' | 'alias' | 'fuzzy';
	accessScope: 'shared_dms_token';
}>;

export interface HotelReferenceResolver {
	resolve(reference: string, orgId: string): Promise<readonly HotelCandidate[]>;
}

export type SlotResolution =
	| Readonly<{
			status: 'ready';
			request: ResolvedBusinessRequest;
			slots: SlotCollection;
	  }>
	| Readonly<{
			status: 'needs_clarification';
			slots: SlotCollection;
			clarification: AgentPendingClarification;
	  }>;

type DateRange = Readonly<{ start: string; end: string; timezone: string; original: string }>;

function formatDate(date: Date, timezone: string): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: timezone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(date);
}

function shiftIsoDate(iso: string, days: number): string {
	const [year, month, day] = iso.split('-').map(Number);
	const shifted = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days));
	return shifted.toISOString().slice(0, 10);
}

export function resolveRelativeDateRange(
	raw: string,
	now: Date,
	timezone = 'Asia/Shanghai'
): DateRange | null {
	const today = formatDate(now, timezone);
	if (/^(今天|today)$/i.test(raw)) return { start: today, end: today, timezone, original: raw };
	if (/^昨天$/.test(raw)) {
		const yesterday = shiftIsoDate(today, -1);
		return { start: yesterday, end: yesterday, timezone, original: raw };
	}
	if (/^最近7天$/.test(raw)) {
		const yesterday = shiftIsoDate(today, -1);
		return {
			start: shiftIsoDate(yesterday, -6),
			end: yesterday,
			timezone,
			original: raw
		};
	}
	if (/^本月至今$/.test(raw)) {
		const [year, month] = today.split('-');
		return {
			start: `${year}-${month}-01`,
			end: today,
			timezone,
			original: raw
		};
	}
	if (/^明天$/.test(raw)) {
		const tomorrow = shiftIsoDate(today, 1);
		return { start: tomorrow, end: tomorrow, timezone, original: raw };
	}
	if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { start: raw, end: raw, timezone, original: raw };
	if (/^上周$/.test(raw)) {
		const noonUtc = new Date(`${today}T12:00:00.000Z`);
		const weekday = noonUtc.getUTCDay() || 7;
		const thisMonday = shiftIsoDate(today, 1 - weekday);
		return {
			start: shiftIsoDate(thisMonday, -7),
			end: shiftIsoDate(thisMonday, -1),
			timezone,
			original: raw
		};
	}
	if (/^上个月$/.test(raw)) {
		const [year, month] = today.split('-').map(Number);
		const start = new Date(Date.UTC(year ?? 0, (month ?? 1) - 2, 1));
		const end = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, 0));
		return {
			start: start.toISOString().slice(0, 10),
			end: end.toISOString().slice(0, 10),
			timezone,
			original: raw
		};
	}
	return null;
}

function resolved(value: JsonValue, detail: string): SlotState {
	return { status: 'resolved', value, source: { kind: 'derived', detail } };
}

function rawText(slot: SlotState | undefined): string | null {
	return slot?.status === 'candidate' && typeof slot.raw === 'string' ? slot.raw.trim() : null;
}

function unresolvedFields(slots: SlotCollection): readonly string[] {
	return Object.entries(slots)
		.filter(([, slot]) => slot.status !== 'resolved')
		.map(([name]) => name);
}

function fieldLabel(slot: string): string {
	const labels: Record<string, string> = {
		hotelReference: '酒店',
		location: '酒店或城市',
		date: '日期',
		dateRange: '日期范围',
		checkIn: '入住日期',
		checkOut: '离店日期',
		guests: '入住人数',
		currency: '币种',
		metrics: '指标'
	};
	return labels[slot] ?? slot;
}

function parseHotelCandidate(value: JsonValue): HotelCandidate | null {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
	const id = Reflect.get(value, 'id');
	const label = Reflect.get(value, 'label');
	const match = Reflect.get(value, 'match');
	if (
		typeof id !== 'string' ||
		typeof label !== 'string' ||
		(match !== 'exact' && match !== 'alias' && match !== 'fuzzy')
	) {
		return null;
	}
	return {
		id,
		label,
		match,
		accessScope: 'shared_dms_token'
	};
}

function buildClarification(
	slots: SlotCollection,
	anchorMessageId: string,
	version: number,
	now: Date
): AgentPendingClarification {
	const fields: AgentPendingClarification['fields'] = unresolvedFields(slots).map((name) => {
		const slot = slots[name];
		if (slot?.status === 'ambiguous' && name === 'hotelReference') {
			return {
				kind: 'single_choice' as const,
				slot: name,
				label: fieldLabel(name),
				required: true,
				choices: slot.candidates.map((candidate) => {
					const hotel = parseHotelCandidate(candidate);
					if (!hotel) throw new Error('Hotel clarification candidate is invalid');
					return { value: hotel.id, label: hotel.label };
				})
			};
		}
		if (name === 'dateRange') {
			return { kind: 'date_range' as const, slot: name, label: fieldLabel(name), required: true };
		}
		if (name === 'date' || name === 'checkIn' || name === 'checkOut') {
			return { kind: 'date' as const, slot: name, label: fieldLabel(name), required: true };
		}
		if (name === 'guests') {
			return {
				kind: 'number' as const,
				slot: name,
				label: fieldLabel(name),
				required: true,
				min: 1,
				max: 20,
				integer: true
			};
		}
		return {
			kind: 'text' as const,
			slot: name,
			label: fieldLabel(name),
			required: true,
			maxLength: 200
		};
	});
	const unmatchedHotel = slots.hotelReference?.status === 'invalid';
	return {
		interactionId: randomUUID(),
		anchorMessageId,
		version,
		prompt: unmatchedHotel
			? '未从酒店数据中匹配到该名称，请输入 OTA 后台显示的完整酒店名称。'
			: `请补充${fields.map((field) => field.label).join('、')}。`,
		fields,
		expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1_000).toISOString()
	};
}

export class BusinessSlotResolver {
	constructor(
		private readonly hotels: HotelReferenceResolver,
		private readonly now: () => Date = () => new Date(),
		private readonly timezone = 'Asia/Shanghai'
	) {}

	async resolve(
		input: Readonly<{
			definition: IntentDefinition;
			intent: AgentBusinessIntent;
			orgId: string;
			slots: SlotCollection;
			anchorMessageId: string;
			version: number;
		}>
	): Promise<SlotResolution> {
		const slots: Record<string, SlotState> = { ...input.slots };
		for (const definition of input.definition.slots) {
			if (!slots[definition.name] && definition.defaultValue !== undefined) {
				slots[definition.name] = ['date', 'dateRange', 'checkIn', 'checkOut'].includes(
					definition.name
				)
					? { status: 'candidate', raw: definition.defaultValue }
					: {
							status: 'resolved',
							value: definition.defaultValue,
							source: { kind: 'application_default' }
						};
			} else if (!slots[definition.name]) {
				slots[definition.name] = { status: 'missing' };
			}
		}

		const hotelRaw = rawText(slots.hotelReference);
		if (hotelRaw) {
			if (/^\d+$/.test(hotelRaw)) {
				slots.hotelReference = resolved(hotelRaw, 'explicit_hotel_id');
			} else {
				const candidates = await this.hotels.resolve(hotelRaw, input.orgId);
				const exact = candidates.filter((candidate) => candidate.match !== 'fuzzy');
				if (exact.length === 1)
					slots.hotelReference = resolved(exact[0]?.id ?? hotelRaw, 'hotel_exact_match');
				else if (candidates.length > 1) {
					slots.hotelReference = {
						status: 'ambiguous',
						candidates: candidates.map((candidate) => ({ ...candidate }))
					};
				} else if (candidates.length === 0)
					slots.hotelReference = { status: 'invalid', reasonCode: 'hotel_not_found' };
				else
					slots.hotelReference = resolved(candidates[0]?.id ?? hotelRaw, 'only_accessible_hotel');
			}
		}

		for (const name of ['date', 'dateRange', 'checkIn', 'checkOut'] as const) {
			const raw = rawText(slots[name]);
			if (!raw) continue;
			const range = resolveRelativeDateRange(raw, this.now(), this.timezone);
			if (!range) slots[name] = { status: 'invalid', reasonCode: 'date_ambiguous' };
			else
				slots[name] = resolved(name === 'dateRange' ? range : range.start, 'application_timezone');
		}

		const unresolved = input.definition.slots.some(
			(definition) => definition.required && slots[definition.name]?.status !== 'resolved'
		);
		if (unresolved) {
			return {
				status: 'needs_clarification',
				slots,
				clarification: buildClarification(slots, input.anchorMessageId, input.version, this.now())
			};
		}
		return {
			status: 'ready',
			slots,
			request: {
				routeKind: 'business_read',
				intent: input.intent,
				slots: Object.fromEntries(
					Object.entries(slots)
						.filter(
							(entry): entry is [string, Extract<SlotState, { status: 'resolved' }>] =>
								entry[1].status === 'resolved'
						)
						.map(([name, slot]) => [name, slot.value])
				)
			}
		};
	}
}
