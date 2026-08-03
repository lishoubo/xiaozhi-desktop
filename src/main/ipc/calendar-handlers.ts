import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { z, type ZodType } from 'zod';
import type { CalendarRepository } from '../../domain/ports/repositories';
import type { AppLogger } from '../../shared/logging';
import {
  calendarEventCreateInputSchema,
  calendarEventIdSchema,
  calendarEventUpdateInputSchema,
} from '../../shared/calendar';
import { IPC_CHANNELS } from '../../shared/ipc-channels';

type RegisterCalendarHandlersOptions = Readonly<{
  window: Readonly<{ webContents: unknown }>;
  repository: CalendarRepository;
  logger: AppLogger;
}>;

export function registerCalendarHandlers({
  window,
  repository,
  logger,
}: RegisterCalendarHandlersOptions): () => void {
  const channels = Object.values(IPC_CHANNELS.calendar);
  const handle = <Arguments extends unknown[]>(
    channel: string,
    argumentsSchema: ZodType<Arguments>,
    listener: (...args: Arguments) => unknown,
  ): void => {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (event.sender !== window.webContents) {
        logger.warn('Rejected untrusted IPC request', { channel });
        throw new Error('拒绝来自非主应用窗口的请求');
      }
      const parsed = argumentsSchema.safeParse(args);
      if (!parsed.success) {
        logger.warn('Rejected invalid IPC request', { channel });
        throw new Error('日程参数无效');
      }
      try {
        return listener(...parsed.data);
      } catch (error) {
        logger.error('Calendar persistence operation failed', {
          operation: channel,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
        throw error;
      }
    });
  };

  handle(IPC_CHANNELS.calendar.load, z.tuple([]), () => repository.load());
  handle(IPC_CHANNELS.calendar.createEvent, z.tuple([calendarEventCreateInputSchema]), (input) => {
    const event = repository.createEvent(input);
    logger.info('Calendar event created', { source: event.source });
    return event;
  });
  handle(IPC_CHANNELS.calendar.updateEvent, z.tuple([calendarEventUpdateInputSchema]), (input) => {
    const event = repository.updateEvent(input);
    logger.info('Calendar event updated', { source: event.source });
    return event;
  });
  handle(IPC_CHANNELS.calendar.deleteEvent, z.tuple([calendarEventIdSchema]), (id) => {
    repository.deleteEvent(id);
    logger.info('Calendar event deleted');
  });

  return () => {
    for (const channel of channels) ipcMain.removeHandler(channel);
  };
}
