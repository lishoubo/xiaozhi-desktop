import type { EmployeeIdentity } from '@hotel-butler/api';
// eslint-disable-next-line import/no-unresolved -- ESLint's legacy resolver does not read this workspace package subpath export.
import { phoneCodeSchema, phoneNumberSchema } from '@hotel-butler/api/contracts';
import { z } from 'zod';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { AppLogger } from '../../shared/logging';
import { createHandlerRegistry, type TrustedWindow } from './create-handler-registry';

/** handler 声明自己需要什么，由 `AuthService` 满足；不 import 实现类。 */
export interface AuthOrchestrator {
  currentSession(): Promise<EmployeeIdentity | null>;
  requestPhoneCode(phone: string): Promise<{ accepted: true; expiresInSeconds: number }>;
  loginWithPhoneCode(phone: string, code: string): Promise<EmployeeIdentity>;
  logout(): Promise<{ success: true }>;
}

type RegisterAuthHandlersOptions = Readonly<{
  service: AuthOrchestrator;
  logger: AppLogger;
  window: TrustedWindow;
}>;

export function registerAuthHandlers({
  service,
  logger,
  window,
}: RegisterAuthHandlersOptions): () => void {
  const registry = createHandlerRegistry({ window, logger });

  registry.handle(IPC_CHANNELS.auth.currentSession, z.tuple([]), '登录参数无效', () =>
    service.currentSession(),
  );
  registry.handle(
    IPC_CHANNELS.auth.requestPhoneCode,
    z.tuple([phoneNumberSchema]),
    '登录参数无效',
    (phone) => service.requestPhoneCode(phone),
  );
  registry.handle(
    IPC_CHANNELS.auth.loginWithPhoneCode,
    z.tuple([phoneNumberSchema, phoneCodeSchema]),
    '登录参数无效',
    (phone, code) => service.loginWithPhoneCode(phone, code),
  );
  registry.handle(IPC_CHANNELS.auth.logout, z.tuple([]), '登录参数无效', () => service.logout());

  return () => registry.dispose();
}
