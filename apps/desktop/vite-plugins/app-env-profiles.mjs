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
 * - `rmsOrigin` 该环境的默认 RMS **API** 地址；`null` 表示尚未确定，构建时必须显式提供
 * - `rmsWebOrigin` 该环境的 RMS **web 页面**地址（应用内打开 RMS 自有页面用）；`null`
 *   表示回落到 `rmsOrigin`。两者分开是因为 dev 下 API 与前端分处不同端口
 *   （`:8080` vs vite dev server `:5173`）；pre/online 由 nginx 同源托管，那是部署
 *   形态的巧合而非可依赖的约束，所以留着这个字段而不是写死"等于 rmsOrigin"
 * - `sentryDsn` 该环境的 GlitchTip 上报地址；`null` 表示不上报（见 sentry-dsn.ts）
 * - `serverOrigin` 该环境的 hotel-butler server 地址（AI 助理与私有 CA 信任用）；
 *   `null` 表示尚未确定，构建时必须显式提供，见 server-origin.ts
 */
/**
 * 三套环境共用一个 GlitchTip Project，靠上报时的 `environment` 标签区分
 * （服务端方案定的，已实测可筛选）。所以 DSN 只有一份，不随环境变化。
 *
 * DSN 里的 key 是 Sentry 协议的 public key —— 只能写入、不能读取项目数据，
 * 随客户端分发是官方用法，不按凭证对待。
 */
const GLITCHTIP_DSN = 'https://623a874052f74e1192e8483ab13d7fcd@121.199.29.74:35444/1';

/**
 * hotel-butler server 的生产地址，与 GlitchTip 同机、同一套私有 CA
 * （见 openspec/specs/server-container-deployment/spec.md 与 apps/desktop/certs/）。
 *
 * pre 与 online 暂时共用它——正式域名尚未启用，和 `rmsOrigin` 的处境一致。
 */
const PRODUCTION_SERVER_ORIGIN = 'https://121.199.29.74:35443';

export const PROFILES = {
  dev: {
    productName: '小智酒店管家[开发]',
    bundleId: 'com.xiaozhi.hotel.dev',
    squirrelName: 'xiaozhi-hotel-dev',
    rmsOrigin: 'http://localhost:8080',
    /**
     * rms-admin 的 vite dev server（rms 仓库 `rms-admin/vite.config.ts` 配的是 5173）。
     * 它自己把 `/api` 代理到 `:8080`，所以页面拿到 token 后照常调得通 API。
     *
     * ⚠️ **这个端口会漂**：本机 `serverOrigin` 也用 5173，Vite 撞端口时会自动 +1；
     * rms-admin 那边为此专门加了 `npm run dev:safe`（先杀残留再起）。真机联调时
     * 先确认它实际起在哪个端口，不一致就用 `XIAOZHI_RMS_WEB_URL=http://localhost:<实际端口>`
     * 覆盖，别改这张表。
     */
    rmsWebOrigin: 'http://localhost:5173',
    // 本地 `npm run dev:server` 起在这个端口（HTTPS，证书由 npm run https:setup 生成）。
    // ⚠️ 与上面的 rmsWebOrigin 同端口不同协议 —— 两个服务同时起会撞，见上。
    serverOrigin: 'https://localhost:5173',
    // 本地开发默认不上报：改代码时的报错是预期内的噪声，往生产项目里刷会淹掉真实故障。
    // 需要联调上报链路时用 XIAOZHI_SENTRY_DSN 显式打开。
    sentryDsn: null,
  },
  pre: {
    productName: '小智酒店管家[预发]',
    bundleId: 'com.xiaozhi.hotel.pre',
    squirrelName: 'xiaozhi-hotel-pre',
    rmsOrigin: 'http://47.96.144.176',
    // null = 回落到 rmsOrigin：该机 nginx 同时托管 SPA 根目录与 /api，两者同源。
    rmsWebOrigin: null,
    serverOrigin: PRODUCTION_SERVER_ORIGIN,
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
    // null = 回落到 rmsOrigin，同 pre。
    rmsWebOrigin: null,
    serverOrigin: PRODUCTION_SERVER_ORIGIN,
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
