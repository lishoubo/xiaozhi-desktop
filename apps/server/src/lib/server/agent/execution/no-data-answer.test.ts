import { describe, expect, it } from 'vitest';
import { buildNoHotelDataAnswer } from './no-data-answer';

describe('empty hotel-data answer', () => {
	it('returns a friendly dated business message without internal terminology', () => {
		const message = buildNoHotelDataAnswer({
			routeKind: 'business_read',
			intent: 'hotel_operating_summary',
			slots: {
				hotelReference: '123',
				dateRange: { start: '2026-08-01', end: '2026-08-07' }
			}
		});

		expect(message).toContain('这家酒店在 2026-08-01 至 2026-08-07');
		expect(message).toContain('没有查到');
		expect(message).not.toMatch(/DMS|MCP|SQL|证据/i);
	});
});
