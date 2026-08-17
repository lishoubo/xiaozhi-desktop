/**
 * 本次构建属于哪一套环境。值由 vite-plugins/app-env.ts 在编译期 define 注入，
 * main / preload / renderer 三端同源。
 *
 * 与 `auth-variant.ts` 同理，用编译期常量而非运行期配置：打包产物被双击启动时拿不到
 * 父进程环境变量，运行时读取会静默兜底成错误配置。
 *
 * ⚠️ 环境**不参与**存储路径计算。数据目录与日志目录由 `app.getName()` 决定，三平台
 * 目录因此自动隔离——主进程里不需要也不应该出现任何 `app.setPath` 或平台路径分支。
 */
export type AppEnvironment = 'dev' | 'pre' | 'online';

export const APP_ENVIRONMENT: AppEnvironment = __APP_ENV__;

/**
 * 本环境的应用展示名，供主进程 `app.setName()` 使用。
 *
 * **为什么不能只靠 forge.config.ts**：那里的 `packagerConfig.name` 只在**打包**时生效。
 * `electron-forge start` 跑 dev 时 `app.getName()` 会回落到 package.json 的
 * `productName`，于是开发数据与正式包挤在同一个目录——2026-08-17 真机就是这么撞上的：
 * dev 建出的 `:dev:` partition 被判成孤儿，每次启动全清，导入 cookie 后仍停在登录页。
 */
export const APP_PRODUCT_NAME: string = __APP_PRODUCT_NAME__;
