import { redactLogData, type LogMessageData } from '../../shared/logging';

type MainLoggingTarget = {
  errorHandler: {
    startCatching: (options: { showDialog: boolean }) => unknown;
  };
  eventLogger: {
    startLogging: (options: { level: 'warn'; scope: string }) => unknown;
  };
  hooks: unknown[];
  info: (...data: unknown[]) => unknown;
  initialize: (options: { includeFutureSessions: boolean; spyRendererConsole: boolean }) => unknown;
  transports: {
    console: { level: string | false };
    file: {
      level: string | false;
      maxSize: number;
    };
    ipc: { level: string | false };
    remote: { level: string | false };
  };
};

type MainLoggingOptions = Readonly<{
  appVersion: string;
  isPackaged: boolean;
  platform: NodeJS.Platform;
}>;

const MAX_LOG_FILE_SIZE = 10 * 1024 * 1024;

export function configureMainLogging(logger: MainLoggingTarget, options: MainLoggingOptions): void {
  logger.transports.file.level = options.isPackaged ? 'info' : 'debug';
  logger.transports.file.maxSize = MAX_LOG_FILE_SIZE;
  logger.transports.console.level = options.isPackaged ? 'warn' : 'debug';
  logger.transports.ipc.level = false;
  logger.transports.remote.level = false;

  if (options.isPackaged) {
    logger.hooks.push((message: LogMessageData) => ({
      ...message,
      data: redactLogData(message.data),
    }));
  }

  logger.initialize({
    includeFutureSessions: true,
    spyRendererConsole: false,
  });
  logger.errorHandler.startCatching({ showDialog: false });
  logger.eventLogger.startLogging({
    level: 'warn',
    scope: 'electron',
  });

  logger.info('Application logging initialized', {
    appVersion: options.appVersion,
    isPackaged: options.isPackaged,
    platform: options.platform,
  });
}

export { redactLogData };
