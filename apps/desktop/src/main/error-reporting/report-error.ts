/**
 * 上报一个已被捕获的错误 —— `ErrorReporter` 的 Sentry 实现。
 *
 * 类型与 noop 在 `error-reporter.ts`；调用方应从那里取，**不要 import 本文件**
 * （本文件会拉进 Sentry SDK 与 electron，见那边的说明）。只有 composition root 例外。
 *
 * ## 与 logger.warn 的分工
 *
 * 两者都要，不是二选一：
 *
 * | | 去处 | 用途 |
 * |---|---|---|
 * | `logger.warn` | 用户机器上的本地文件 | 拿到日志后逐行排查 |
 * | `reportError`  | GlitchTip | 不用等业户发日志就知道出事了、出了多少 |
 *
 * 所以调用点通常是"先 warn 再 report"，不要因为加了上报就把本地日志删掉。
 */
import * as Sentry from '@sentry/electron/main';
import type { ErrorReporter } from './error-reporter';

/**
 * **不抛异常**：上报失败绝不能影响业务路径——调用点多半正处在错误处理里，
 * 再抛一个出去只会把原始错误盖掉。
 */
export const reportError: ErrorReporter = (error, context) => {
  try {
    Sentry.withScope((scope) => {
      scope.setTag('operation', context.operation);
      if (context.channel) scope.setTag('channel', context.channel);
      if (context.hotelId) scope.setTag('hotel_id', context.hotelId);
      if (context.extra) scope.setContext('detail', context.extra);
      Sentry.captureException(error);
    });
  } catch {
    // 故意吞掉：见上。本地日志那条已经在调用点写过了。
  }
};

export type { ErrorReportContext, ErrorReporter } from './error-reporter';
