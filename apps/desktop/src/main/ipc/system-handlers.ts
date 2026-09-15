import { z } from 'zod';
import type { SystemPreferences } from '../../shared/browser';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { AppLogger } from '../../shared/logging';
import { createHandlerRegistry, type TrustedWindow } from './create-handler-registry';

const noArgumentsSchema = z.tuple([]);

/** handler 声明自己需要什么，由 `SystemService` 满足；不 import 实现类。 */
export interface SystemOrchestrator {
  getPreferences(): SystemPreferences;
  setAutoLaunch(enabled: boolean): SystemPreferences;
  openLogsDirectory(): Promise<void>;
  openExternal(url: string): Promise<void>;
}

type RegisterSystemHandlersOptions = Readonly<{
  window: TrustedWindow;
  service: SystemOrchestrator;
  logger: AppLogger;
}>;

export function registerSystemHandlers({
  window,
  service,
  logger,
}: RegisterSystemHandlersOptions): () => void {
  const registry = createHandlerRegistry({ window, logger });

  registry.handle(IPC_CHANNELS.system.getPreferences, noArgumentsSchema, '请求参数无效', () =>
    service.getPreferences(),
  );
  registry.handle(
    IPC_CHANNELS.system.setAutoLaunch,
    z.tuple([z.boolean()]),
    '开机启动设置无效',
    (enabled) => service.setAutoLaunch(enabled),
  );
  registry.handle(IPC_CHANNELS.system.openLogsDirectory, noArgumentsSchema, '请求参数无效', () =>
    service.openLogsDirectory(),
  );
  // 协议白名单在 service 里，不在这里：schema 只管"是不是个字符串"。
  registry.handle(
    IPC_CHANNELS.system.openExternal,
    z.tuple([z.string().min(1)]),
    '链接无效',
    (url) => service.openExternal(url),
  );

  return () => registry.dispose();
}
