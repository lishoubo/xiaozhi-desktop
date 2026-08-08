/* eslint-disable import/no-unresolved -- ESLint's legacy resolver does not read this workspace package subpath export. */
import { staffIdentitySchema, staffLogoutResponseSchema } from '@hotel-butler/api/contracts';
/* eslint-enable import/no-unresolved */
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { ValidatedInvoke } from '../invoke';

export function createStaffAuthApi(invoke: ValidatedInvoke) {
  return Object.freeze({
    currentSession: () =>
      invoke(staffIdentitySchema.nullable(), IPC_CHANNELS.staffAuth.currentSession),
    login: (username: string, password: string) =>
      invoke(staffIdentitySchema, IPC_CHANNELS.staffAuth.login, username, password),
    logout: () => invoke(staffLogoutResponseSchema, IPC_CHANNELS.staffAuth.logout),
  });
}
