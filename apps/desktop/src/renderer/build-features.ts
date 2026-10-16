/**
 * 按**构建环境**收敛界面入口。
 *
 * ## 与 `permissions.ts` 的分工
 *
 * 两者都决定"要不要显示某个入口"，但判据完全不同，不可合并：
 *
 * | | 判据 | 回答的问题 | 何时变化 |
 * |---|---|---|---|
 * | `permissions.ts` | 登录身份 | 这个人能不能看 | 运行期，换个人登录就变 |
 * | 本文件 | 构建环境 | 这个包要不要带 | 编译期，烧进产物不再变 |
 *
 * 把环境判断塞进 `capabilitiesOf` 会让"换人登录"和"换个包"两件事纠缠在一起，
 * 而它们的生命周期根本不同。
 *
 * ## 为什么导出的是常量，规则却单独成函数
 *
 * `APP_ENVIRONMENT` 由 `vite-plugins/app-env.ts` 在编译期 `define` 注入，是被
 * Rollup 折叠掉的字面量——于是 `{#if SHOW_AGENT_NAV}` 在 online 构建里整块被 DCE
 * 摇掉，入口不是"藏起来"，是**根本不在产物里**。
 *
 * 但正因为是编译期常量，单测只能看到 vitest 配置里固定的那一个环境（当前是 dev），
 * 直接断言常量值验不到 online。所以把规则抽成 `hidesPreviewModules(env)`，
 * 让三套环境的行为都能被钉死。
 */
import { APP_ENVIRONMENT, type AppEnvironment } from '../shared/app-environment';

/**
 * 该环境是否隐藏「仍在打磨、暂不进正式包」的模块。
 *
 * 只有 `online` 隐藏：dev / pre 要继续开发验证这些页面。
 */
export function hidesPreviewModules(environment: AppEnvironment): boolean {
  return environment === 'online';
}

/**
 * 运营日历与 AI 助理暂不进正式包。
 *
 * **路由仍然注册**——只摘掉侧边栏入口，手输地址或代码内跳转依旧可达，不留死链。
 */
export const SHOW_AGENT_NAV: boolean = !hidesPreviewModules(APP_ENVIRONMENT);
export const SHOW_CALENDAR_NAV: boolean = !hidesPreviewModules(APP_ENVIRONMENT);
