import { z } from 'zod';
import type {
  CalendarEventCreateInput as DomainCalendarEventCreateInput,
  CalendarEventRecord as DomainCalendarEventRecord,
  CalendarGroup as DomainCalendarGroup,
} from '../shared/types/calendar';

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

// 类型的权威在 shared/types/calendar.ts，这里只做 re-export。
export type {
  CalendarEventCreateInput,
  CalendarEventRecord,
  CalendarEventSource,
  CalendarEventUpdateInput,
  CalendarGroup,
  CalendarSnapshot,
} from './types/calendar';

/*
 * 编译期守卫：schema 推导出的形状必须与 shared/types/calendar.ts 的类型一致，
 * 任一侧改了字段而另一侧没跟上就报错。
 *
 * 这里曾经写成 `type AssertExtends<A extends B, B> = [A, B] extends [B, A] ? true : true`
 * —— 三元的两个分支同为 `true`，条件永远不影响结果，是个只有形式没有作用的
 * 假守卫。现在改为把约束放在类型参数上（`A extends B`），不满足时 TS 在实例化
 * 处直接报错。
 */
// 只比字段结构，不比 readonly 修饰：z.infer 出的是可变对象，而这边的类型统一
// 包了 Readonly<>，那是形式差异而非字段不一致。
type Expect<T extends true> = T;
type MutuallyExtends<A, B> = A extends B ? (B extends A ? true : false) : false;

export type _CalendarSchemasMatchTypes = [
  Expect<MutuallyExtends<z.infer<typeof calendarGroupSchema>, DomainCalendarGroup>>,
  Expect<MutuallyExtends<z.infer<typeof calendarEventRecordSchema>, DomainCalendarEventRecord>>,
  Expect<
    MutuallyExtends<z.infer<typeof calendarEventCreateInputSchema>, DomainCalendarEventCreateInput>
  >,
];
