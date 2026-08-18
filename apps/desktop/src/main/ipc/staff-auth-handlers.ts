import type { StaffIdentity, StaffPhoneCodeRequestResponse } from '@hotel-butler/api';
import {
  phoneCodeSchema,
  phoneNumberSchema,
  staffPasswordSchema,
  staffUsernameSchema,
  // eslint-disable-next-line import/no-unresolved -- ESLint's legacy resolver does not read this workspace package subpath export.
} from '@hotel-butler/api/contracts';
import { z } from 'zod';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { AppLogger } from '../../shared/logging';
import { createHandlerRegistry, type TrustedWindow } from './create-handler-registry';

/** handler 声明自己需要什么，由 `StaffAuthService` 满足；不 import 实现类。 */
export interface StaffAuthOrchestrator {
  currentSession(): Promise<StaffIdentity | null>;
  login(username: string, password: string): Promise<StaffIdentity>;
  requestPhoneCode(phone: string): Promise<StaffPhoneCodeRequestResponse>;
  loginWithPhoneCode(phone: string, code: string): Promise<StaffIdentity>;
  logout(): Promise<{ success: true }>;
}

type RegisterStaffAuthHandlersOptions = Readonly<{
  service: StaffAuthOrchestrator;
  logger: AppLogger;
  window: TrustedWindow;
}>;

export function registerStaffAuthHandlers({
  service,
  logger,
  window,
}: RegisterStaffAuthHandlersOptions): () => void {
  const registry = createHandlerRegistry({ window, logger });

  registry.handle(IPC_CHANNELS.staffAuth.currentSession, z.tuple([]), '登录参数无效', () =>
    service.currentSession(),
  );
  registry.handle(
    IPC_CHANNELS.staffAuth.login,
    z.tuple([staffUsernameSchema, staffPasswordSchema]),
    '登录参数无效',
    (username, password) => service.login(username, password),
  );
  registry.handle(
    IPC_CHANNELS.staffAuth.requestPhoneCode,
    z.tuple([phoneNumberSchema]),
    '手机号格式不正确',
    (phone) => service.requestPhoneCode(phone),
  );
  registry.handle(
    IPC_CHANNELS.staffAuth.loginWithPhoneCode,
    z.tuple([phoneNumberSchema, phoneCodeSchema]),
    '登录参数无效',
    (phone, code) => service.loginWithPhoneCode(phone, code),
  );
  registry.handle(IPC_CHANNELS.staffAuth.logout, z.tuple([]), '登录参数无效', () =>
    service.logout(),
  );

  return () => registry.dispose();
}
