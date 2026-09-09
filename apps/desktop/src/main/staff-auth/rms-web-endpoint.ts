/**
 * 解析 RMS **web 页面**地址 —— 应用内打开 RMS 自有页面（统一改价页等）的目标。
 *
 * 与 `rms-endpoint.ts` 的 `resolveRmsOrigin()` **刻意分开**：那个是 API 地址，主进程
 * 发业务请求用；这个是 web 前端地址。部署环境下两者同源（nginx 同时托管 SPA 与
 * `/api`），但那是部署形态的巧合，不是可依赖的约束 —— dev 下 API 在 `:8080`、
 * rms-admin 的 dev server 在 `:5173`，复用同一个值会打开一个不存在的页面。
 *
 * 取值与校验同样都在构建期完成（见 vite-plugins/rms-web-origin.ts）：`__RMS_WEB_ORIGIN__`
 * 是被 Rollup 折叠掉的字面量。不在运行时读 `process.env` 的理由见 `rms-endpoint.ts`。
 */
export function resolveRmsWebOrigin(): string {
  return __RMS_WEB_ORIGIN__;
}
