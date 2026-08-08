import { z } from 'zod';
import type { CtripCheckInResult } from '../../shared/automation';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { AppLogger } from '../../shared/logging';
import { createHandlerRegistry, type TrustedWindow } from './create-handler-registry';

const noArgumentsSchema = z.tuple([]);

type RegisterAutomationHandlersOptions = Readonly<{
  window: TrustedWindow;
  result: Promise<CtripCheckInResult> | null;
  logger: AppLogger;
}>;

export function registerAutomationHandlers({
  window,
  result,
  logger,
}: RegisterAutomationHandlersOptions): () => void {
  const registry = createHandlerRegistry({ window, logger });

  registry.handle(
    IPC_CHANNELS.automation.getCtripCheckIn,
    noArgumentsSchema,
    '请求参数无效',
    () => result,
  );

  return () => registry.dispose();
}
