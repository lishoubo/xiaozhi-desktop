/**
 * 主进程错误上报（GlitchTip / Sentry 协议）的初始化。
 *
 * ## 为什么要它——本地日志不够
 *
 * `electron-log` 只写用户机器上的文件，出问题得让业户手动打包发回来。而**最关键的
 * 一类错误本地一个字都留不下**：主进程崩溃、native crash、渲染进程白屏。这些正是
 * SDK 白送的能力，不用自己写。
 *
 * ## 脱敏是硬要求，不是可选项
 *
 * 上报内容会夹带渠道 cookie 与酒店经营数据。`beforeSend` 里复用 `shared/logging.ts`
 * 那套现成的 `redactLogData` —— 它已覆盖 Bearer token、cookie、手机号、URL 里的
 * 内嵌凭证，且能处理循环引用与 cause 链，没有理由再写一套。
 *
 * ⚠️ 必须过**整个 event**，不能只过 `event.request`：异常 message、breadcrumb、
 * extra、tags 里都可能夹带凭证，漏掉任何一处都等于外泄一份。
 *
 * ## 没配 DSN 就静默跳过
 *
 * dev 环境默认不配（见 `vite-plugins/app-env-profiles.mjs`）。缺 DSN 只是少了上报，
 * 应用其余功能完全正常，所以不抛错、不告警刷屏，info 一行即可。
 */
import * as Sentry from '@sentry/electron/main';
import { APP_ENVIRONMENT } from '../../shared/app-environment';
import { type AppLogger } from '../../shared/logging';
import { trustPrivateCaGlobally } from './global-ca-trust';
import { redactEvent } from './redact-event';

export type ErrorReportingOptions = Readonly<{
  appVersion: string;
  /** 随包分发的私有 CA；`null` 表示没有（dev 模式或未打包），此时不装全局信任。 */
  privateCaPem: string | null;
  logger: AppLogger;
}>;

export function initializeErrorReporting(options: ErrorReportingOptions): void {
  const dsn = __SENTRY_DSN__;
  if (!dsn) {
    options.logger.info('Error reporting is disabled (no DSN configured)', {
      appEnvironment: APP_ENVIRONMENT,
    });
    return;
  }

  // 必须在 Sentry.init 之前：SDK 一旦开始上报就要用到这条信任链。GlitchTip 用的是
  // 私有 CA 签发的自签证书，不装信任的话上报会全部 TLS 握手失败，且失败是静默的。
  if (options.privateCaPem) trustPrivateCaGlobally(options.privateCaPem, options.logger);

  Sentry.init({
    dsn,
    // 三套环境共用一个 Project，靠这个标签区分（服务端方案已实测可筛选）。
    environment: APP_ENVIRONMENT,
    release: `xiaozhi-desktop@${options.appVersion}`,
    // 错误事件试跑期先全量；真正要防的是崩溃循环刷屏，那由服务端聚合与保留期兜底。
    sampleRate: 1,
    // 性能追踪本次不需要，明确关掉——它的事件量远大于错误本身。
    tracesSampleRate: 0,
    maxBreadcrumbs: 50,
    beforeSend: (event) => redactEvent(event),
    beforeBreadcrumb: (breadcrumb) => redactEvent(breadcrumb),
  });

  options.logger.info('Error reporting initialized', {
    appEnvironment: APP_ENVIRONMENT,
    release: options.appVersion,
  });
}
