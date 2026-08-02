import { describe, expect, it } from 'vitest';
import { formatCalendarRangeLabel } from '../../src/renderer/calendar/calendar-navigation';

describe('calendar navigation labels', () => {
  it('shows both months for a week that crosses a month boundary', () => {
    expect(
      formatCalendarRangeLabel('week', '8月30日–5日, 2026', {
        start: new Date(2026, 7, 30),
        end: new Date(2026, 8, 6),
      }),
    ).toBe('2026年8月30日–9月5日');
  });

  it('shows both years for a week that crosses a year boundary', () => {
    expect(
      formatCalendarRangeLabel('week', '12月27日–2日, 2027', {
        start: new Date(2026, 11, 27),
        end: new Date(2027, 0, 3),
      }),
    ).toBe('2026年12月27日–2027年1月2日');
  });

  it('preserves the library label outside week view', () => {
    expect(
      formatCalendarRangeLabel('month', '2026年8月', {
        start: new Date(2026, 7, 1),
        end: new Date(2026, 8, 1),
      }),
    ).toBe('2026年8月');
  });
});
