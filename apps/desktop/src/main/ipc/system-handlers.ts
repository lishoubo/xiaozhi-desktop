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

  return () => registry.dispose();
}
