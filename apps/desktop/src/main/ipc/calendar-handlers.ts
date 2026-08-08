import { z } from 'zod';
import type {
  CalendarEventCreateInput,
  CalendarEventRecord,
  CalendarEventUpdateInput,
  CalendarSnapshot,
} from '../../domain/calendar';
import type { AppLogger } from '../../shared/logging';
import {
  calendarEventCreateInputSchema,
  calendarEventIdSchema,
  calendarEventUpdateInputSchema,
} from '../../shared/calendar';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { createHandlerRegistry, type TrustedWindow } from './create-handler-registry';

/** handler 声明自己需要什么，由 `CalendarService` 满足；不 import 实现类。 */
export interface CalendarOrchestrator {
  load(): CalendarSnapshot;
  createEvent(input: CalendarEventCreateInput): CalendarEventRecord;
  updateEvent(input: CalendarEventUpdateInput): CalendarEventRecord;
  deleteEvent(id: string): void;
}

type RegisterCalendarHandlersOptions = Readonly<{
  window: TrustedWindow;
  service: CalendarOrchestrator;
  logger: AppLogger;
}>;

export function registerCalendarHandlers({
  window,
  service,
  logger,
}: RegisterCalendarHandlersOptions): () => void {
  const registry = createHandlerRegistry({ window, logger });

  registry.handle(IPC_CHANNELS.calendar.load, z.tuple([]), '日程参数无效', () => service.load());
  registry.handle(
    IPC_CHANNELS.calendar.createEvent,
    z.tuple([calendarEventCreateInputSchema]),
    '日程参数无效',
    (input) => service.createEvent(input),
  );
  registry.handle(
    IPC_CHANNELS.calendar.updateEvent,
    z.tuple([calendarEventUpdateInputSchema]),
    '日程参数无效',
    (input) => service.updateEvent(input),
  );
  registry.handle(
    IPC_CHANNELS.calendar.deleteEvent,
    z.tuple([calendarEventIdSchema]),
    '日程参数无效',
    (id) => service.deleteEvent(id),
  );

  return () => registry.dispose();
}
