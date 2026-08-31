/**
 * 环境差异的唯一来源。**新增环境只改这张表。**
 *
 * 为什么是 `.mjs` 而不是 `.ts`：这张表同时被两类消费方读取——
 *
 * ```
 * vite-plugins/app-env.ts   构建期注入（走 Vite，TS 没问题）
 * scripts/desktop-*.mjs     打包/清理脚本（裸 Node 直接跑，没有 TS 编译步骤）
 * ```
 *
 * 让脚本去 import 一个 `.ts` 会依赖 Node 的类型剥离（版本相关、且带警告）。表本身
 * 没有类型可言，做成 `.mjs` 两边都能直接读，类型由 `app-env.ts` 那一侧补上。
 */

/** @typedef {'dev' | 'pre' | 'online'} AppEnvironment */

export const ENVIRONMENTS = /** @type {const} */ (['dev', 'pre', 'online']);

/**
 * 缺省取 `dev` 而非 `online`：误打出连着本机的开发包，风险远低于误打出连着生产的包。
 * @type {AppEnvironment}
 */
export const DEFAULT_ENVIRONMENT = 'dev';

/**
 * - `productName` 展示名，同时是各平台数据目录与日志目录名的来源
 * - `bundleId` macOS CFBundleIdentifier；三环境不同才能并存安装
 * - `squirrelName` Windows Squirrel 内部标识，决定 `%LOCALAPPDATA%\<name>` 与注册表
 *   卸载项。与展示名分开是因为 Squirrel 对非 ASCII 字符支持不佳
 * - `rmsOrigin` 该环境的默认 RMS 地址；`null` 表示尚未确定，构建时必须显式提供
 * - `sentryDsn` 该环境的 GlitchTip 上报地址；`null` 表示不上报（见 sentry-dsn.ts）
 */
/**
 * 三套环境共用一个 GlitchTip Project，靠上报时的 `environment` 标签区分
 * （服务端方案定的，已实测可筛选）。所以 DSN 只有一份，不随环境变化。
 *
 * DSN 里的 key 是 Sentry 协议的 public key —— 只能写入、不能读取项目数据，
 * 随客户端分发是官方用法，不按凭证对待。
 */
const GLITCHTIP_DSN = 'https://623a874052f74e1192e8483ab13d7fcd@121.199.29.74:35444/1';

export const PROFILES = {
  dev: {
    productName: '小智酒店管家[开发]',
    bundleId: 'com.xiaozhi.hotel.dev',
    squirrelName: 'xiaozhi-hotel-dev',
    rmsOrigin: 'http://localhost:8080',
    // 本地开发默认不上报：改代码时的报错是预期内的噪声，往生产项目里刷会淹掉真实故障。
    // 需要联调上报链路时用 XIAOZHI_SENTRY_DSN 显式打开。
    sentryDsn: null,
  },
  pre: {
    productName: '小智酒店管家[预发]',
    bundleId: 'com.xiaozhi.hotel.pre',
    squirrelName: 'xiaozhi-hotel-pre',
    rmsOrigin: 'http://47.96.144.176',
    sentryDsn: GLITCHTIP_DSN,
  },
  online: {
    productName: '小智酒店管家',
    bundleId: 'com.xiaozhi.hotel',
    squirrelName: 'xiaozhi-hotel',
    // ⚠️ 当前与 pre 指向同一台 RMS —— 正式域名尚未启用。这意味着**正式包与预发包连的
    // 是同一个后端**，两者的数据不隔离；且它是明文 HTTP，JWT 会明文传输（打包时会
    // 每次告警，见 scripts/desktop-make.mjs）。正式域名上 HTTPS 后改这里即可，
    // 届时告警会自动消失。
    rmsOrigin: 'http://47.96.144.176',
    sentryDsn: GLITCHTIP_DSN,
  },
};

export function isAppEnvironment(value) {
  return ENVIRONMENTS.includes(value);
}

/** 非法值抛错，绝不静默回退成默认环境。 */
export function resolveAppEnvironment(environment = process.env) {
  const raw = environment.XIAOZHI_APP_ENV;
  if (raw === undefined || raw === '') return DEFAULT_ENVIRONMENT;
  if (!isAppEnvironment(raw)) {
    throw new Error(`XIAOZHI_APP_ENV 取值非法: ${raw}（可选 ${ENVIRONMENTS.join(' | ')}）`);
  }
  return raw;
}

export function environmentProfile(environment = process.env) {
  return PROFILES[resolveAppEnvironment(environment)];
}
