/* eslint-disable import/no-unresolved -- ESLint's legacy resolver does not read this workspace package subpath export. */
import {
  employeeIdentitySchema,
  logoutResponseSchema,
  phoneCodeRequestResponseSchema,
} from '@hotel-butler/api/contracts';
/* eslint-enable import/no-unresolved */
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { ValidatedInvoke } from '../invoke';

export function createAuthApi(invoke: ValidatedInvoke) {
  return Object.freeze({
    currentSession: () =>
      invoke(employeeIdentitySchema.nullable(), IPC_CHANNELS.auth.currentSession),
    loginWithPhoneCode: (phone: string, code: string) =>
      invoke(employeeIdentitySchema, IPC_CHANNELS.auth.loginWithPhoneCode, phone, code),
    logout: () => invoke(logoutResponseSchema, IPC_CHANNELS.auth.logout),
    requestPhoneCode: (phone: string) =>
      invoke(phoneCodeRequestResponseSchema, IPC_CHANNELS.auth.requestPhoneCode, phone),
  });
}
