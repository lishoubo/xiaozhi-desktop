import { ctripCheckInResultSchema } from '../../shared/automation';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { ValidatedInvoke } from '../invoke';

const optionalCtripCheckInResultSchema = ctripCheckInResultSchema.nullable();

export function createAutomationApi(invoke: ValidatedInvoke) {
  return Object.freeze({
    getCtripCheckIn: () =>
      invoke(optionalCtripCheckInResultSchema, IPC_CHANNELS.automation.getCtripCheckIn),
  });
}
