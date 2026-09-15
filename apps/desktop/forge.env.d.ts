/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

/**
 * RMS 服务端地址：由 vite-plugins/rms-origin.ts 在主进程构建里 define 注入。
 * 编译期字面量，取值和合法性校验都发生在构建时。
 */
declare const __RMS_ORIGIN__: string;

/**
 * RMS **web 页面**地址：由 vite-plugins/rms-web-origin.ts 在主进程构建里注入。
 * 与 `__RMS_ORIGIN__`（API 地址）分开——dev 下两者分处不同端口，见该插件注释。
 */
declare const __RMS_WEB_ORIGIN__: string;

/** hotel-butler server 地址：由 vite-plugins/server-origin.ts 在构建期注入。 */
declare const __SERVER_ORIGIN__: string;

/**
 * 构建环境：由 vite-plugins/app-env.ts 在三处构建里 define 注入。
 * 决定应用标识（进而决定各平台的数据与日志目录）、RMS 默认地址与 partition 命名。
 */
declare const __APP_ENV__: 'dev' | 'pre' | 'online';

/**
 * 该环境的应用展示名：由 vite-plugins/app-env.ts 在三处构建里 define 注入。
 * 主进程用它 `app.setName()`，使 dev 模式也落到本环境专属的数据/日志目录。
 */
declare const __APP_PRODUCT_NAME__: string;

/**
 * GlitchTip 上报地址：由 vite-plugins/sentry-dsn.ts 在 main / renderer 构建里注入。
 * 空串表示本次构建不上报（dev 环境默认如此）。
 */
declare const __SENTRY_DSN__: string;

/**
 * 自动更新源（OSS bucket 根地址）：由 vite-plugins/update-feed.ts 在主进程构建里注入。
 * 空串表示本环境不启用自动更新（dev / pre 默认如此）。
 */
declare const __UPDATE_FEED_URL__: string;

/**
 * 灰度名单的手机号哈希盐值：由 vite-plugins/update-feed.ts 在主进程构建里注入。
 * 空串表示未配置。它随包分发、可被拆包取得，不按凭证对待——见该插件注释。
 */
declare const __UPDATE_SALT__: string;
