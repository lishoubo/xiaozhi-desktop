/**
 * 日历的领域模型 —— 纯类型，零运行时依赖。
 *
 * 与 `shared/calendar.ts` 的分工：
 *   domain/  = 业务是什么（这里）—— 纯 TS 类型，不 import zod
 *   shared/  = 跨进程传输契约 —— zod schema，运行时校验 IPC 入参
 *
 * schema 负责在边界上把不可信输入验成这些类型，两者必须保持结构一致；
 * `shared/calendar.ts` 里有编译期断言守住这个一致性。
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
