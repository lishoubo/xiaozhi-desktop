/**
 * GlitchTip 上报地址（Sentry DSN）的构建期注入。
 *
 * 与 `rms-origin.ts` 同理烧在构建期：打包产物被双击启动时拿不到父进程环境变量，
 * 运行时读取会静默兜底成"没配 DSN"，打出一个**看起来正常、实则不上报**的包。
 *
 * 与 rms-origin 的差别：主进程和渲染进程都要 `Sentry.init`，所以三个构建都挂
 * （形状同 `app-env.ts`），不像 RMS 地址只挂主进程一处。
 *
 * ## DSN 里的 key 不是密钥
 *
 * Sentry 协议的 public key 本就设计成随客户端分发，它只能写入、不能读取项目数据。
 * 所以直接烧进产物是官方用法，不需要按凭证对待。
 *
 * ## 不配就是关闭上报，不是构建失败
 *
 * 与 RMS 地址相反：连错后端会打出一个功能异常的包，必须构建失败；而缺 DSN 只是
 * 少了错误上报，应用其余功能完全正常。本地开发、CI 构建都不该被它卡住，所以
 * 默认值是空串，`init-error-reporting.ts` 见空即跳过初始化。
 */
import type { Plugin } from 'vite';
import { environmentProfile } from './app-env';

export function resolveSentryDsnForBuild(
  environment: NodeJS.ProcessEnv = process.env,
  profileOf: typeof environmentProfile = environmentProfile,
): string {
  const raw = environment.XIAOZHI_SENTRY_DSN;
  if (raw !== undefined && raw !== '') return raw.trim();
  return profileOf(environment).sentryDsn ?? '';
}

export function sentryDsnDefine(): Plugin {
  const dsn = resolveSentryDsnForBuild();
  return {
    name: 'xiaozhi-sentry-dsn',
    config: () => ({
      define: { __SENTRY_DSN__: JSON.stringify(dsn) },
    }),
  };
}
