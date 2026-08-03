import { z } from 'zod';
import type {
  CalendarEventCreateInput as DomainCalendarEventCreateInput,
  CalendarEventRecord as DomainCalendarEventRecord,
  CalendarGroup as DomainCalendarGroup,
} from '../domain/calendar';

export const calendarGroupSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(80),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  isSystem: z.boolean(),
});

export const calendarEventRecordSchema = z.object({
  id: z.string().min(1).max(128),
  calendarId: z.string().min(1).max(80),
  title: z.string().min(1).max(200),
  startsAt: z.string().datetime({ local: true, offset: true }),
  endsAt: z.string().datetime({ local: true, offset: true }),
  allDay: z.boolean(),
  notes: z.string().max(2000),
  source: z.enum(['holiday-seed', 'user']),
});

export const calendarSnapshotSchema = z.object({
  groups: z.array(calendarGroupSchema),
  events: z.array(calendarEventRecordSchema),
});

const mutableCalendarEventFieldsSchema = z.object({
  calendarId: z.string().min(1).max(80),
  title: z.string().trim().min(1).max(200),
  startsAt: z.string().datetime({ local: true, offset: true }),
  endsAt: z.string().datetime({ local: true, offset: true }),
  allDay: z.boolean(),
  notes: z.string().max(2000),
});

export const calendarEventCreateInputSchema = mutableCalendarEventFieldsSchema
  .extend({ id: z.string().min(1).max(128) })
  .refine((value) => value.endsAt > value.startsAt, {
    message: '日程结束时间必须晚于开始时间',
  });

export const calendarEventUpdateInputSchema = z.object({
  id: z.string().min(1).max(128),
  event: mutableCalendarEventFieldsSchema
    .partial()
    .refine((value) => Object.keys(value).length > 0),
});

export const calendarEventIdSchema = z.string().min(1).max(128);

// 领域类型的权威在 domain/，这里只做 re-export —— 依赖方向是 shared 引 domain。
export type {
  CalendarEventCreateInput,
  CalendarEventRecord,
  CalendarEventSource,
  CalendarEventUpdateInput,
  CalendarGroup,
  CalendarSnapshot,
} from '../domain/calendar';

// 编译期守卫：schema 推导出的形状必须与 domain 类型一致。
// 任一侧改了字段而另一侧没跟上，这里会立刻报错。
type AssertExtends<A extends B, B> = [A, B] extends [B, A] ? true : true;

export type _CalendarSchemasMatchDomain = [
  AssertExtends<z.infer<typeof calendarGroupSchema>, DomainCalendarGroup>,
  AssertExtends<DomainCalendarGroup, z.infer<typeof calendarGroupSchema>>,
  AssertExtends<z.infer<typeof calendarEventRecordSchema>, DomainCalendarEventRecord>,
  AssertExtends<DomainCalendarEventRecord, z.infer<typeof calendarEventRecordSchema>>,
  AssertExtends<z.infer<typeof calendarEventCreateInputSchema>, DomainCalendarEventCreateInput>,
  AssertExtends<DomainCalendarEventCreateInput, z.infer<typeof calendarEventCreateInputSchema>>,
];
