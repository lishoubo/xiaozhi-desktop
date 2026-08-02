import { describe, expect, it } from 'vitest';
import {
  createAllDayCalendarDraft,
  isValidCalendarDateRange,
} from '../../src/renderer/calendar/calendar-editor';

describe('calendar editor date logic', () => {
  it('creates a local all-day range for the clicked date', () => {
    const draft = createAllDayCalendarDraft(new Date(2026, 7, 15, 18, 30));

    expect(draft).toEqual({
      start: new Date(2026, 7, 15),
      end: new Date(2026, 7, 16),
      allDay: true,
    });
  });

  it('accepts only real ranges whose start is before the end', () => {
    expect(isValidCalendarDateRange(new Date(2025, 0, 1), new Date(2025, 0, 2))).toBe(true);
    expect(isValidCalendarDateRange(new Date(2026, 7, 2), new Date(2026, 7, 2))).toBe(false);
    expect(isValidCalendarDateRange(new Date(2026, 7, 3), new Date(2026, 7, 2))).toBe(false);
    expect(isValidCalendarDateRange(new Date('invalid'), new Date(2026, 7, 2))).toBe(false);
  });
});
