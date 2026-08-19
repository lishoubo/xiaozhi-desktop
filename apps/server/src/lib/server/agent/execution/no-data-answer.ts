import type { JsonValue, ResolvedBusinessRequest } from './business-execution-state';

function requestedPeriod(slots: Readonly<Record<string, JsonValue>>): string | null {
	const range = slots.dateRange;
	if (typeof range === 'object' && range !== null && !Array.isArray(range)) {
		const start = Reflect.get(range, 'start');
		const end = Reflect.get(range, 'end');
		if (typeof start === 'string' && typeof end === 'string') {
			return start === end ? start : `${start} 至 ${end}`;
		}
	}
	const date = slots.date;
	return typeof date === 'string' && date.trim() ? date : null;
}

function hotelSubject(value: JsonValue | undefined): string {
	if (Array.isArray(value)) return '这些酒店';
	if (typeof value !== 'string' || /^\d+$/.test(value)) return '这家酒店';
	return `“${value}”`;
}

export function buildNoHotelDataAnswer(request: ResolvedBusinessRequest): string {
	const period = requestedPeriod(request.slots);
	const subject = hotelSubject(request.slots.hotelReference);
	const scope = period ? `${subject}在 ${period}` : `${subject}在当前查询条件下`;
	return `没有查到${scope}的相关经营数据。可能该时段尚未产生或尚未同步数据，你可以换一个日期范围再试。`;
}
