/**
 * IPC handler 的统一注册器。
 *
 * 收敛此前复制在 6 个 `*-handlers.ts` 里的同一套样板：信任校验 → 参数校验 →
 * 调用 listener → 注销。其中**信任校验是安全代码**（拒绝非主窗口发来的 IPC），
 * 复制 6 份意味着漏改一处即漏洞，所以这里只保留一份实现。
 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { ZodType } from 'zod';
import type { AppLogger } from '../../shared/logging';

export type TrustedWindow = Readonly<{ webContents: unknown }>;

export type HandlerRegistry = Readonly<{
  /**
   * 注册一个 channel。
   *
   * @param invalidInputMessage 参数校验失败时抛给渲染进程的文案。不复用 zod 的
   *   原始报错——那会把内部字段名泄漏到 UI 上。
   * @param listener 收到的是已通过 schema 校验的参数。需要 `IpcMainInvokeEvent`
   *   的场景用 `handleWithEvent`。
   */
  handle<Arguments extends unknown[]>(
    channel: string,
    argumentsSchema: ZodType<Arguments>,
    invalidInputMessage: string,
    listener: (...args: Arguments) => unknown,
  ): void;
  /** 与 `handle` 相同，但把原始 event 透给 listener（用于取 `event.sender`）。 */
  handleWithEvent<Arguments extends unknown[]>(
    channel: string,
    argumentsSchema: ZodType<Arguments>,
    invalidInputMessage: string,
    listener: (event: IpcMainInvokeEvent, ...args: Arguments) => unknown,
  ): void;
  /** 注销本 registry 注册过的全部 channel。 */
  dispose(): void;
}>;

export type HandlerRegistryOptions = Readonly<{
  window: TrustedWindow;
  logger: AppLogger;
}>;

export function createHandlerRegistry({ window, logger }: HandlerRegistryOptions): HandlerRegistry {
  const registered: string[] = [];

  const register = <Arguments extends unknown[]>(
    channel: string,
    argumentsSchema: ZodType<Arguments>,
    invalidInputMessage: string,
    listener: (event: IpcMainInvokeEvent, ...args: Arguments) => unknown,
  ): void => {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (event.sender !== window.webContents) {
        logger.warn('Rejected untrusted IPC request', { channel });
        throw new Error('拒绝来自非主应用窗口的请求');
      }
      const parsed = argumentsSchema.safeParse(args);
      if (!parsed.success) {
        logger.warn('Rejected invalid IPC request', { channel });
        throw new Error(invalidInputMessage);
      }
      return listener(event, ...parsed.data);
    });
    registered.push(channel);
  };

  return {
    handle(channel, argumentsSchema, invalidInputMessage, listener) {
      register(channel, argumentsSchema, invalidInputMessage, (_event, ...args) =>
        listener(...args),
      );
    },
    handleWithEvent: register,
    dispose() {
      for (const channel of registered) ipcMain.removeHandler(channel);
      registered.length = 0;
    },
  };
}
