import { z } from 'zod';
import type { CalendarRepository } from '../../domain/ports/repositories';
import type { AppLogger } from '../../shared/logging';
import {
  calendarEventCreateInputSchema,
  calendarEventIdSchema,
  calendarEventUpdateInputSchema,
} from '../../shared/calendar';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { createHandlerRegistry, type TrustedWindow } from './create-handler-registry';

type RegisterCalendarHandlersOptions = Readonly<{
  window: TrustedWindow;
  repository: CalendarRepository;
  logger: AppLogger;
}>;

export function registerCalendarHandlers({
  window,
  repository,
  logger,
}: RegisterCalendarHandlersOptions): () => void {
  const registry = createHandlerRegistry({ window, logger });

  /** 持久化失败时记一条带 channel 的日志再原样抛出，便于定位是哪个操作坏的。 */
  const logFailure = <T>(channel: string, operation: () => T): T => {
    try {
      return operation();
    } catch (error) {
      logger.error('Calendar persistence operation failed', {
        operation: channel,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      throw error;
    }
  };

  registry.handle(IPC_CHANNELS.calendar.load, z.tuple([]), '日程参数无效', () =>
    logFailure(IPC_CHANNELS.calendar.load, () => repository.load()),
  );
  registry.handle(
    IPC_CHANNELS.calendar.createEvent,
    z.tuple([calendarEventCreateInputSchema]),
    '日程参数无效',
    (input) =>
      logFailure(IPC_CHANNELS.calendar.createEvent, () => {
        const event = repository.createEvent(input);
        logger.info('Calendar event created', { source: event.source });
        return event;
      }),
  );
  registry.handle(
    IPC_CHANNELS.calendar.updateEvent,
    z.tuple([calendarEventUpdateInputSchema]),
    '日程参数无效',
    (input) =>
      logFailure(IPC_CHANNELS.calendar.updateEvent, () => {
        const event = repository.updateEvent(input);
        logger.info('Calendar event updated', { source: event.source });
        return event;
      }),
  );
  registry.handle(
    IPC_CHANNELS.calendar.deleteEvent,
    z.tuple([calendarEventIdSchema]),
    '日程参数无效',
    (id) =>
      logFailure(IPC_CHANNELS.calendar.deleteEvent, () => {
        repository.deleteEvent(id);
        logger.info('Calendar event deleted');
      }),
  );

  return () => registry.dispose();
}
