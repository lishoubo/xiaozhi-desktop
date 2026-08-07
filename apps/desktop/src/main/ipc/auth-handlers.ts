import type { AppRouter, EmployeeIdentity } from '@hotel-butler/api';
// eslint-disable-next-line import/no-unresolved -- ESLint's legacy resolver does not read this workspace package subpath export.
import { phoneCodeSchema, phoneNumberSchema } from '@hotel-butler/api/contracts';
import type { TRPCClient } from '@trpc/client';
import { ipcMain, type Cookies, type IpcMainInvokeEvent } from 'electron';
import { z, type ZodType } from 'zod';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { AppLogger } from '../../shared/logging';

export const DESKTOP_SESSION_COOKIE_NAME = '__Host-xiaozhi_desktop_session';

type AuthClient = Pick<TRPCClient<AppRouter>, 'auth'>;

type RegisterAuthHandlersOptions = Readonly<{
  apiSession: Readonly<{ cookies: Pick<Cookies, 'remove'> }>;
  client: AuthClient;
  logger: AppLogger;
  serverOrigin: string;
  window: Readonly<{ webContents: unknown }>;
}>;

export function registerAuthHandlers({
  apiSession,
  client,
  logger,
  serverOrigin,
  window,
}: RegisterAuthHandlersOptions): () => void {
  const channels = Object.values(IPC_CHANNELS.auth);
  const handle = <Arguments extends unknown[]>(
    channel: string,
    argumentsSchema: ZodType<Arguments>,
    listener: (...args: Arguments) => Promise<unknown>,
  ): void => {
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (event.sender !== window.webContents) {
        logger.warn('Rejected untrusted IPC request', { channel });
        throw new Error('拒绝来自非主应用窗口的请求');
      }
      const parsed = argumentsSchema.safeParse(args);
      if (!parsed.success) {
        logger.warn('Rejected invalid IPC request', { channel });
        throw new Error('登录参数无效');
      }
      return listener(...parsed.data);
    });
  };

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

  handle(IPC_CHANNELS.auth.currentSession, z.tuple([]), () =>
    safeCall('current-session', '无法验证登录状态，请重试', () =>
      client.auth.currentSession.query(),
    ),
  );
  handle(IPC_CHANNELS.auth.requestPhoneCode, z.tuple([phoneNumberSchema]), (phone) =>
    safeCall('request-code', '验证码发送失败，请重试', () =>
      client.auth.requestPhoneCode.mutate({ phone }),
    ),
  );
  handle(
    IPC_CHANNELS.auth.loginWithPhoneCode,
    z.tuple([phoneNumberSchema, phoneCodeSchema]),
    (phone, code): Promise<EmployeeIdentity> =>
      safeCall('login', '登录失败，请检查手机号和验证码', () =>
        client.auth.loginWithPhoneCode.mutate({ phone, code }),
      ),
  );
  handle(IPC_CHANNELS.auth.logout, z.tuple([]), async () => {
    try {
      return await safeCall('logout', '退出登录失败，请重试', () => client.auth.logout.mutate());
    } finally {
      await apiSession.cookies.remove(serverOrigin, DESKTOP_SESSION_COOKIE_NAME);
    }
  });

  return () => {
    for (const channel of channels) ipcMain.removeHandler(channel);
  };
}
