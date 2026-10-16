/* eslint-disable import/no-unresolved -- ESLint's legacy resolver does not read this workspace package subpath export. */
import {
  staffIdentitySchema,
  staffLogoutResponseSchema,
  staffPhoneCodeRequestResponseSchema,
} from '@hotel-butler/api/contracts';
/* eslint-enable import/no-unresolved */
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { z } from 'zod';
import type { ValidatedInvoke, ValidatedSubscribe } from '../invoke';

export function createStaffAuthApi(invoke: ValidatedInvoke, subscribe: ValidatedSubscribe) {
  return Object.freeze({
    currentSession: () =>
      invoke(staffIdentitySchema.nullable(), IPC_CHANNELS.staffAuth.currentSession),
    login: (username: string, password: string) =>
      invoke(staffIdentitySchema, IPC_CHANNELS.staffAuth.login, username, password),
    requestPhoneCode: (phone: string) =>
      invoke(staffPhoneCodeRequestResponseSchema, IPC_CHANNELS.staffAuth.requestPhoneCode, phone),
    loginWithPhoneCode: (phone: string, code: string) =>
      invoke(staffIdentitySchema, IPC_CHANNELS.staffAuth.loginWithPhoneCode, phone, code),
    logout: () => invoke(staffLogoutResponseSchema, IPC_CHANNELS.staffAuth.logout),
    onSessionEnded: (listener: () => void) =>
      subscribe(z.undefined(), IPC_CHANNELS.staffAuth.sessionEnded, listener),
  });
}
