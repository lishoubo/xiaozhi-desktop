import type { AppRouter, EmployeeIdentity } from '@hotel-butler/api';
// eslint-disable-next-line import/no-unresolved -- ESLint's legacy resolver does not read this workspace package subpath export.
import { phoneCodeSchema, phoneNumberSchema } from '@hotel-butler/api/contracts';
import type { TRPCClient } from '@trpc/client';
import { z } from 'zod';
import type { Cookies } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { AppLogger } from '../../shared/logging';
import { createHandlerRegistry, type TrustedWindow } from './create-handler-registry';

export const DESKTOP_SESSION_COOKIE_NAME = '__Host-xiaozhi_desktop_session';

type AuthClient = Pick<TRPCClient<AppRouter>, 'auth'>;

type RegisterAuthHandlersOptions = Readonly<{
  apiSession: Readonly<{ cookies: Pick<Cookies, 'remove'> }>;
  client: AuthClient;
  logger: AppLogger;
  serverOrigin: string;
  window: TrustedWindow;
}>;

export function registerAuthHandlers({
  apiSession,
  client,
  logger,
  serverOrigin,
  window,
}: RegisterAuthHandlersOptions): () => void {
  const registry = createHandlerRegistry({ window, logger });

  /** 远端失败一律转成用户可读文案，不把 tRPC 的原始错误透给渲染进程。 */
  const safeCall = async <T>(
    operation: string,
    message: string,
    call: () => Promise<T>,
  ): Promise<T> => {
    try {
      return await call();
    } catch (error) {
      logger.warn('Desktop authentication operation failed', {
        operation,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      throw new Error(message);
    }
  };

  registry.handle(IPC_CHANNELS.auth.currentSession, z.tuple([]), '登录参数无效', () =>
    safeCall('current-session', '无法验证登录状态，请重试', () => client.auth.currentSession.query()),
  );
  registry.handle(
    IPC_CHANNELS.auth.requestPhoneCode,
    z.tuple([phoneNumberSchema]),
    '登录参数无效',
    (phone) =>
      safeCall('request-code', '验证码发送失败，请重试', () =>
        client.auth.requestPhoneCode.mutate({ phone }),
      ),
  );
  registry.handle(
    IPC_CHANNELS.auth.loginWithPhoneCode,
    z.tuple([phoneNumberSchema, phoneCodeSchema]),
    '登录参数无效',
    (phone, code): Promise<EmployeeIdentity> =>
      safeCall('login', '登录失败，请检查手机号和验证码', () =>
        client.auth.loginWithPhoneCode.mutate({ phone, code }),
      ),
  );
  registry.handle(IPC_CHANNELS.auth.logout, z.tuple([]), '登录参数无效', async () => {
    try {
      return await safeCall('logout', '退出登录失败，请重试', () => client.auth.logout.mutate());
    } finally {
      // 无论远端是否成功都要清本地 session cookie，否则会留下"已登出但仍带凭证"的状态。
      await apiSession.cookies.remove(serverOrigin, DESKTOP_SESSION_COOKIE_NAME);
    }
  });

  return () => registry.dispose();
}
