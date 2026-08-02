import { z } from 'zod';

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

export type CalendarGroup = z.infer<typeof calendarGroupSchema>;
export type CalendarEventRecord = z.infer<typeof calendarEventRecordSchema>;
export type CalendarSnapshot = z.infer<typeof calendarSnapshotSchema>;
export type CalendarEventCreateInput = z.infer<typeof calendarEventCreateInputSchema>;
export type CalendarEventUpdateInput = z.infer<typeof calendarEventUpdateInputSchema>;
