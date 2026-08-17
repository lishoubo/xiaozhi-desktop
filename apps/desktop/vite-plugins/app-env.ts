/**
 * 构建环境开关：决定这个包属于哪一套环境（dev / pre / online）。
 *
 * ## 为什么烧在构建期
 *
 * 与 `rms-origin.ts` 同理：打包产物是被双击启动的，父进程环境里没有任何变量，
 * 运行时读取会静默兜底成错误配置。环境必须在构建时就固化进产物。
 *
 * 三个 vite config（main / preload / renderer）是三次独立的 Rollup 构建，`define`
 * 是每次构建各自的编译期替换，没有跨构建共享的机制——所以三处都得挂一次本插件，
 * 形状与 `auth-variant.ts` 一致。
 *
 * ## 取值表在别处
 *
 * 环境差异的唯一来源是 `app-env-profiles.mjs`。那张表同时被打包/清理脚本（裸 Node，
 * 没有 TS 编译步骤）读取，所以做成 `.mjs`；本文件只负责给它补上类型。
 *
 * ```
 * XIAOZHI_APP_ENV=pre
 *       │
 *       ├─→ forge packagerConfig.name / appBundleId
 *       ├─→ MakerSquirrel.name           (Windows 安装目录 + 注册表卸载项)
 *       └─→ app.getName()
 *               │
 *               ├─ macOS   ~/Library/Application Support/小智酒店管家[预发]/
 *               ├─ Windows %APPDATA%\小智酒店管家[预发]\
 *               └─ Linux   ~/.config/小智酒店管家[预发]/
 * ```
 *
 * **只改应用标识，不碰存储路径代码**：`productName` 一变，三个平台的数据目录、日志
 * 目录、Windows 注册表项全部自动隔离，无需任何 `app.setPath` 与平台分支。
 */
import type { Plugin } from 'vite';
import { environmentProfile, resolveAppEnvironment } from './app-env-profiles.mjs';

// 取值与取值表都在 .mjs 那侧，这里原样转出，调用方只需认这一个模块。
export type { AppEnvironment, EnvironmentProfile } from './app-env-profiles.mjs';
export { environmentProfile, resolveAppEnvironment } from './app-env-profiles.mjs';

/** 三个 vite config 共用，确保 main / preload / renderer 拿到同一个值。 */
export function appEnvDefine(): Plugin {
  const appEnv = resolveAppEnvironment();
  const { productName } = environmentProfile();
  return {
    name: 'xiaozhi-app-env',
    config: () => ({
      define: {
        __APP_ENV__: JSON.stringify(appEnv),
        // 主进程要用它 `app.setName()`：dev 模式下 forge 的 packagerConfig 不生效，
        // 不注入的话 `app.getName()` 会回落到 package.json 的 productName，
        // 导致开发数据与正式包挤在同一个目录。
        __APP_PRODUCT_NAME__: JSON.stringify(productName),
      },
    }),
  };
}
