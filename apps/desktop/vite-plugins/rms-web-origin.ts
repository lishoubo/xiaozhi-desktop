/**
 * RMS **web 页面**地址的构建期注入 —— 应用内打开 RMS 自有页面（如统一改价页）的目标。
 *
 * ## 为什么与 `rms-origin.ts` 分开
 *
 * 那个是 **API** 地址（主进程发业务请求的目标），这个是 **web 前端**地址。两者在
 * 部署环境下恰好同源（nginx 同时托管 SPA 根目录与 `/api`），但 dev 下分处不同端口：
 *
 * ```
 * dev     API  http://localhost:8080     web  http://localhost:5173  ← vite dev server
 * pre     API  http://47.96.144.176      web  同上（nginx 同源托管）
 * online  同 pre
 * ```
 *
 * 同源是**部署形态的巧合**，不是可依赖的约束 —— nginx 配置随时可能把前端拆到别的
 * 域名。所以留成两个独立取值，而不是让 web 地址直接复用 API 地址。
 *
 * ## 取值优先级
 *
 * `XIAOZHI_RMS_WEB_URL` > 当前环境 profile 的 `rmsWebOrigin` > 该环境的 `rmsOrigin`
 *
 * 回落到 API 地址是刻意的：部署环境下两者同源是常态，强制每个环境重复填一遍徒增
 * 出错面。dev 的 profile 显式填了 `:5173`，不会走到回落。
 *
 * 明文 HTTP 的校验与豁免同 `rms-origin.ts` —— 这个地址同样承载访问令牌（令牌随
 * URL query 传给页面），裸奔出本机一样有被劫持的风险。
 */
import { assertRmsUrlAllowed } from './rms-origin';
import { environmentProfile, resolveAppEnvironment } from './app-env';
import type { Plugin } from 'vite';

/**
 * `profileOf` 只为测试留的接缝，同 `rms-origin.ts` 的同名参数：真实的三个环境里
 * `rmsOrigin` 都已填值，没有环境能触发「两个地址都缺」那条规则。
 */
export function resolveRmsWebOriginForBuild(
  environment: NodeJS.ProcessEnv = process.env,
  profileOf: typeof environmentProfile = environmentProfile,
): string {
  const raw = environment.XIAOZHI_RMS_WEB_URL;
  if (raw === undefined || raw === '') {
    const { rmsWebOrigin, rmsOrigin } = profileOf(environment);
    // 回落到 API 地址：部署环境下两者同源。
    const fallback = rmsWebOrigin ?? rmsOrigin;
    if (fallback === null) {
      throw new Error(
        `环境 ${resolveAppEnvironment(environment)} 尚未配置 RMS web 页面地址，其 API 地址也未配置。\n` +
          '请在 vite-plugins/app-env-profiles.mjs 的 PROFILES 中填入 rmsWebOrigin 或 rmsOrigin，' +
          '或显式设置 XIAOZHI_RMS_WEB_URL。',
      );
    }
    // profile 里的值同样要过校验：把明文地址写进表里与写在命令行上，风险一样。
    return assertRmsUrlAllowed(fallback, environment, 'XIAOZHI_RMS_WEB_URL');
  }

  return assertRmsUrlAllowed(raw, environment, 'XIAOZHI_RMS_WEB_URL');
}

export function rmsWebOriginDefine(): Plugin {
  const origin = resolveRmsWebOriginForBuild();
  return {
    name: 'xiaozhi-rms-web-origin',
    config: () => ({
      define: { __RMS_WEB_ORIGIN__: JSON.stringify(origin) },
    }),
  };
}
