/**
 * 日程的业务编排。当前四个方法都只是转发到仓储，但这一层仍然存在，因为
 * IPC 层的准入标准是「只调 service」——一旦为 calendar 开例外，这条边界就
 * 无法用 lint 强制，也就形同虚设。持久化失败的日志归口也收在这里。
 */
import type {
  CalendarEventCreateInput,
  CalendarEventRecord,
  CalendarEventUpdateInput,
  CalendarSnapshot,
} from '../../shared/types/calendar';
import type { CalendarRepository } from '../repositories';
import type { AppLogger } from '../../shared/logging';

export type CalendarServiceDependencies = Readonly<{
  repository: CalendarRepository;
  logger: AppLogger;
}>;

export class CalendarService {
  constructor(private readonly deps: CalendarServiceDependencies) {}

  load(): CalendarSnapshot {
    return this.run('load', () => this.deps.repository.load());
  }

  createEvent(input: CalendarEventCreateInput): CalendarEventRecord {
    return this.run('createEvent', () => {
      const event = this.deps.repository.createEvent(input);
      this.deps.logger.info('Calendar event created', { source: event.source });
      return event;
    });
  }

  updateEvent(input: CalendarEventUpdateInput): CalendarEventRecord {
    return this.run('updateEvent', () => {
      const event = this.deps.repository.updateEvent(input);
      this.deps.logger.info('Calendar event updated', { source: event.source });
      return event;
    });
  }

  deleteEvent(id: string): void {
    this.run('deleteEvent', () => {
      this.deps.repository.deleteEvent(id);
      this.deps.logger.info('Calendar event deleted');
    });
  }

  /** 持久化失败时记一条带操作名的日志再原样抛出，便于定位是哪个操作坏的。 */
  private run<T>(operation: string, action: () => T): T {
    try {
      return action();
    } catch (error) {
      this.deps.logger.error('Calendar persistence operation failed', {
        operation,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      throw error;
    }
  }
}
