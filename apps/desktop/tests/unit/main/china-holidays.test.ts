import { describe, expect, it } from 'vitest';
import { chinaMainlandHolidaySeed } from '../../../src/main/calendar/china-holidays';

describe('chinaMainlandHolidaySeed', () => {
  it('provides seven holiday events for every year from 2026 through 2036', () => {
    const events = chinaMainlandHolidaySeed();

    expect(events).toHaveLength(77);
    expect(new Set(events.map((event) => event.id)).size).toBe(77);
    expect(events.every((event) => event.calendarId === 'china-mainland-holidays')).toBe(true);
    expect(events.every((event) => event.source === 'holiday-seed')).toBe(true);
  });

  it('uses the published 2026 holiday periods and known future festival dates', () => {
    const events = chinaMainlandHolidaySeed();

    expect(events).toContainEqual(
      expect.objectContaining({
        id: 'cn-holiday-2026-spring-festival',
        title: '春节',
        startsAt: '2026-02-15T00:00:00.000',
        endsAt: '2026-02-24T00:00:00.000',
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        id: 'cn-holiday-2028-qingming',
        startsAt: '2028-04-04T00:00:00.000',
        endsAt: '2028-04-05T00:00:00.000',
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        id: 'cn-holiday-2036-mid-autumn',
        startsAt: '2036-10-04T00:00:00.000',
        endsAt: '2036-10-05T00:00:00.000',
      }),
    );
  });
});
