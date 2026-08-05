export type AllDayCalendarDraft = Readonly<{
  start: Date;
  end: Date;
  allDay: true;
}>;

function isRealDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

export function createAllDayCalendarDraft(date: Date): AllDayCalendarDraft {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end, allDay: true };
}

export function isValidCalendarDateRange(start: unknown, end: unknown): boolean {
  return isRealDate(start) && isRealDate(end) && start.getTime() < end.getTime();
}

export function parseCalendarCellDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getFullYear() === Number(match[1]) &&
    date.getMonth() === Number(match[2]) - 1 &&
    date.getDate() === Number(match[3])
    ? date
    : null;
}
