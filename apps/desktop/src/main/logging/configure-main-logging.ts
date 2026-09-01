import path from 'node:path';
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
      // depth 与 electron-log 的实际签名对齐（它允许 null/undefined 表示「不限制/用默认」），
      // 这里写窄了会让 index.ts 传入真实 logger 时类型不兼容。
      inspectOptions: { depth?: number | null };
      resolvePathFn: (...arguments_: never[]) => string;
    };
    ipc: { level: string | false };
    remote: { level: string | false };
  };
};

type MainLoggingOptions = Readonly<{
  appVersion: string;
  isPackaged: boolean;
  logsDirectory: string;
  platform: NodeJS.Platform;
}>;

type ElectronLogDirectoryTarget = Readonly<{
  getPath(name: 'logs'): string;
  setAppLogsPath(path?: string): void;
}>;

const MAX_LOG_FILE_SIZE = 10 * 1024 * 1024;

/**
 * 文件日志展开对象的最大嵌套层数。
 *
 * Node 的 `util.inspect`（electron-log 底层用的就是它）默认 `depth: 2`，超出的一律缩写成
 * `[Object]`，**且是在写入那一刻就丢掉了**，事后无法从日志文件里还原。默认值对通用场景是
 * 合理的保守选择（对象可能循环引用、可能巨大），但对我们排查用的结构化日志偏紧。
 *
 * ⚠️ **调大 depth 不是「深层数据丢失」的可靠解法**，只是让常见的中等嵌套好读一点。
 * 2026-08-11 真机两次证明了这一点：美团改价上报体有两种形状，`calcPriceModels` 比
 * `calcPriceUnifiedDateModel` 深一层，价格恰好落在最深处，depth 调到 8 仍然被截。
 * **渠道请求体的嵌套深度不由我们控制，追着调 depth 是打地鼠。**
 *
 * 真正需要保证完整落盘的字段（如上报体 `requestBody`），应在**调用点**先
 * `JSON.stringify` 成字符串再交给日志 —— 字符串没有嵌套，任何深度都完整。
 * 见 `channels/amount-change-watcher.ts` 对渠道报文的处理。
 *
 * **只给 file transport 放开**：console 保持 Node 默认，避免开发时终端被大对象刷屏；
 * 文件日志本来就是留着事后排查的，可读性优先。
 */
const FILE_LOG_INSPECT_DEPTH = 8;

export function configureDesktopLogDirectory(
  electronApp: ElectronLogDirectoryTarget,
  profileDirectoryName: string,
): string {
  electronApp.setAppLogsPath();
  const profileDirectory = path.join(electronApp.getPath('logs'), profileDirectoryName);
  electronApp.setAppLogsPath(profileDirectory);
  return electronApp.getPath('logs');
}

export function configureMainLogging(logger: MainLoggingTarget, options: MainLoggingOptions): void {
  const logFilePath = path.join(options.logsDirectory, 'main.log');
  logger.transports.file.level = options.isPackaged ? 'info' : 'debug';
  logger.transports.file.maxSize = MAX_LOG_FILE_SIZE;
  logger.transports.file.inspectOptions = { depth: FILE_LOG_INSPECT_DEPTH };
  logger.transports.file.resolvePathFn = () => logFilePath;
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
    logFilePath,
    platform: options.platform,
  });
}

export { redactLogData };
