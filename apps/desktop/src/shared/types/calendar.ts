/**
 * 日历的数据形状 —— 纯类型，零运行时依赖。
 *
 * 与 `shared/calendar.ts` 的分工：这里是数据形状，那里是 zod schema
 * （在 IPC 边界上把不可信输入验成这些类型）。两者必须保持结构一致。
 */

export type CalendarEventSource = 'holiday-seed' | 'user';

export type CalendarGroup = Readonly<{
  id: string;
  label: string;
  color: string;
  isSystem: boolean;
}>;

export type CalendarEventRecord = Readonly<{
  id: string;
  calendarId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  notes: string;
  source: CalendarEventSource;
}>;

export type CalendarSnapshot = Readonly<{
  groups: readonly CalendarGroup[];
  events: readonly CalendarEventRecord[];
}>;

export type CalendarEventCreateInput = Readonly<{
  id: string;
  calendarId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  notes: string;
}>;

export type CalendarEventUpdateInput = Readonly<{
  id: string;
  event: Partial<Omit<CalendarEventCreateInput, 'id'>>;
}>;
