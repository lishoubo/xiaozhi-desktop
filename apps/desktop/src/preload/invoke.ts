/**
 * IPC 调用的校验包装。
 *
 * 类型只保护编译期调用方；这两个包装器保护的是**运行时**——主进程返回的值
 * 跨进程边界后不再有类型保证，schema 在这里把它验回来。
 */
import type { ZodType } from 'zod';

export type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;
export type Subscribe = (channel: string, listener: (value: unknown) => void) => () => void;

export type ValidatedInvoke = <T>(
  schema: ZodType<T>,
  channel: string,
  ...args: unknown[]
) => Promise<T>;

export type ValidatedSubscribe = <T>(
  schema: ZodType<T>,
  channel: string,
  listener: (value: T) => void,
) => () => void;

export function createValidatedInvoke(invoke: Invoke): ValidatedInvoke {
  return (schema, channel, ...args) =>
    invoke(channel, ...args).then((value) => {
      const result = schema.safeParse(value);
      if (!result.success) throw new Error('主进程返回的数据格式无效');
      return result.data;
    });
}

export function createValidatedSubscribe(subscribe: Subscribe): ValidatedSubscribe {
  return (schema, channel, listener) =>
    subscribe(channel, (value) => {
      const result = schema.safeParse(value);
      // 事件是"通知"而非"请求"：格式不对就丢弃，不打断渲染进程。
      if (result.success) listener(result.data);
    });
}
