import { z } from 'zod';
import {
  calendarEventRecordSchema,
  calendarSnapshotSchema,
  type CalendarEventCreateInput,
  type CalendarEventUpdateInput,
} from '../../shared/calendar';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { ValidatedInvoke } from '../invoke';

const voidSchema = z.undefined();

export function createCalendarApi(invoke: ValidatedInvoke) {
  return Object.freeze({
    load: () => invoke(calendarSnapshotSchema, IPC_CHANNELS.calendar.load),
    createEvent: (input: CalendarEventCreateInput) =>
      invoke(calendarEventRecordSchema, IPC_CHANNELS.calendar.createEvent, input),
    updateEvent: (input: CalendarEventUpdateInput) =>
      invoke(calendarEventRecordSchema, IPC_CHANNELS.calendar.updateEvent, input),
    deleteEvent: (id: string) => invoke(voidSchema, IPC_CHANNELS.calendar.deleteEvent, id),
  });
}
