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

/**
 * 把 catch 到的原因摊成日志字段。
 *
 * 渲染层原先清一色写 `{ errorName: reason instanceof Error ? reason.name : 'UnknownError' }`。
 * 那是被 `redactLogData` 的兜底逼出来的——它当时会把 Error 削成 `{ name }`，而 name
 * 对绝大多数错误恒为 `'Error'`，于是日志里只剩这一个词。兜底已改成保留（脱敏后的）
 * message / stack / cause，这里就能直接把错误交出去。
 *
 * 仍返回一个对象而不是裸 error：调用点几乎都要再带 credentialId / channel 这类业务
 * 关联键，`{ ...errorFields(reason), credentialId }` 是最省事的拼法。
 */
export function errorFields(reason: unknown): Readonly<{ error: unknown }> {
  return { error: reason instanceof Error ? reason : String(reason) };
}
