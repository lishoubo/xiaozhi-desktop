import { redactLogData, type LogMessageData } from '../shared/logging';

type RendererLoggingTarget = {
  errorHandler: {
    startCatching: (options: { showDialog: boolean }) => unknown;
  };
  hooks: unknown[];
  info: (...data: unknown[]) => unknown;
  transports: {
    console: { level: string | false };
    ipc: { level: string | false };
  };
};

type RendererLoggingOptions = Readonly<{
  isDevelopment: boolean;
}>;

export function configureRendererLogging(
  logger: RendererLoggingTarget,
  options: RendererLoggingOptions,
): void {
  logger.transports.console.level = options.isDevelopment ? 'debug' : 'warn';
  logger.transports.ipc.level = options.isDevelopment ? 'debug' : 'info';
  logger.hooks.push((message: LogMessageData) => ({
    ...message,
    data: redactLogData(message.data),
  }));
  logger.errorHandler.startCatching({ showDialog: false });
  logger.info('Renderer logging initialized');
}
