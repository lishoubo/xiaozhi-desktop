import { describe, expect, it } from 'vitest';
import { greetingNameOf, weekdayLabel } from '../../src/renderer/session-greeting';

describe('greetingNameOf', () => {
  it('prefers the full name over the login username', () => {
    expect(greetingNameOf({ username: 'libo', fullName: '李守波' })).toBe('李守波');
  });

  it('falls back to the username when the staff has no full name', () => {
    expect(greetingNameOf({ username: 'libo', fullName: null })).toBe('libo');
  });

  it('reports no name without a session', () => {
    expect(greetingNameOf(null)).toBeNull();
  });
});

describe('weekdayLabel', () => {
  // getDay() 的 0 是周日，直接拿它索引「星期一…」开头的表会整体错一位。
  it('names Sunday as 星期日 rather than 星期六', () => {
    expect(weekdayLabel(new Date(2026, 7, 9))).toBe('星期日');
  });

  it('names a midweek day', () => {
    expect(weekdayLabel(new Date(2026, 7, 12))).toBe('星期三');
  });
});
