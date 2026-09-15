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
  /**
   * 身份确认后的旁路通知（自动更新靠它拿手机号做灰度判定）。
   *
   * ⚠️ **三条路径都要覆盖**：`currentSession` 是冷启动恢复会话走的路，只挂
   * `login` 会让"已登录用户重启应用"永远触发不到——而那恰恰是最常见的用法，
   * 客户不会每天重新登录。
   *
   * 是旁路不是主链：回调抛错不该让登录失败，所以在这里吞掉并记日志。
   */
  onIdentityResolved?: (identity: StaffIdentity) => void;
}>;

export function registerStaffAuthHandlers({
  service,
  logger,
  window,
  onIdentityResolved,
}: RegisterStaffAuthHandlersOptions): () => void {
  const registry = createHandlerRegistry({ window, logger });

  const notifyIdentity = (identity: StaffIdentity | null): void => {
    if (identity === null || onIdentityResolved === undefined) return;
    try {
      onIdentityResolved(identity);
    } catch (error) {
      logger.warn('Identity-resolved listener failed', { error });
    }
  };

  registry.handle(IPC_CHANNELS.staffAuth.currentSession, z.tuple([]), '登录参数无效', async () => {
    const identity = await service.currentSession();
    notifyIdentity(identity);
    return identity;
  });
  registry.handle(
    IPC_CHANNELS.staffAuth.login,
    z.tuple([staffUsernameSchema, staffPasswordSchema]),
    '登录参数无效',
    async (username, password) => {
      const identity = await service.login(username, password);
      notifyIdentity(identity);
      return identity;
    },
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
    async (phone, code) => {
      const identity = await service.loginWithPhoneCode(phone, code);
      notifyIdentity(identity);
      return identity;
    },
  );
  registry.handle(IPC_CHANNELS.staffAuth.logout, z.tuple([]), '登录参数无效', () =>
    service.logout(),
  );

  return () => registry.dispose();
}
