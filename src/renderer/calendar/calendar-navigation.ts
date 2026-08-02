export type CalendarView = 'day' | 'week' | 'month';

type DateRange = Readonly<{ start: Date; end: Date }>;

function inclusiveEnd(end: Date): Date {
  return new Date(end.getTime() - 1);
}

export function formatCalendarRangeLabel(
  view: CalendarView,
  defaultLabel: string,
  range: DateRange,
): string {
  if (view !== 'week') return defaultLabel;
  const start = range.start;
  const end = inclusiveEnd(range.end);
  const startLabel = `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日`;
  const endLabel =
    start.getFullYear() === end.getFullYear()
      ? `${end.getMonth() + 1}月${end.getDate()}日`
      : `${end.getFullYear()}年${end.getMonth() + 1}月${end.getDate()}日`;
  return `${startLabel}–${endLabel}`;
}
