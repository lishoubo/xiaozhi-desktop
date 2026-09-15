/**
 * 自动更新源与灰度盐值的构建期注入。
 *
 * 与 `sentry-dsn.ts` 同一范式——**缺了就是关闭该能力，不是构建失败**：
 *
 * ```
 * rmsOrigin   缺 → 构建失败    连错后端的包功能是坏的，必须拦住
 * sentryDsn   缺 → 静默关闭    少了上报，其余功能正常
 * updateFeed  缺 → 静默关闭    dev/pre 本就不分发给客户，没有更新源是常态
 * ```
 *
 * 按 rmsOrigin 那样处理会让本地 `npm run make:desktop:dev` 直接挂掉。
 *
 * ## 只挂主进程
 *
 * 更新检查全程在主进程：渲染进程只接收一条"已就绪"通知，不需要知道更新源在哪。
 * 与 `sentry-dsn.ts`（主进程和渲染进程都要 init）不同，这里只挂 `vite.main.config.ts`。
 *
 * ## 盐值不是密钥
 *
 * 它随包分发，拆包即可取得。作用是让灰度名单里的 `sha256(手机号 + 盐)` 无法被
 * "拿到公开 URL 就穷举 11 位手机号"还原——挡的是这个，不是逆向。
 * 因此与 DSN 同样直接烧进产物，不按凭证对待。
 */
import type { Plugin } from 'vite';
import { environmentProfile } from './app-env';

/**
 * 更新源根地址。空串表示本环境不启用自动更新。
 *
 * 末尾斜杠统一去掉：下游要拼 `/updates/` 与 `/update-manifest.json`，
 * 留着会拼出 `//updates/`。
 */
export function resolveUpdateFeedUrlForBuild(
  environment: NodeJS.ProcessEnv = process.env,
  profileOf: typeof environmentProfile = environmentProfile,
): string {
  const raw = environment.XIAOZHI_UPDATE_FEED_URL;
  const value = raw !== undefined && raw !== '' ? raw : (profileOf(environment).updateFeedUrl ?? '');
  return value.trim().replace(/\/+$/, '');
}

/** 灰度名单的手机号哈希盐值。空串表示未配置。 */
export function resolveUpdateSaltForBuild(
  environment: NodeJS.ProcessEnv = process.env,
  profileOf: typeof environmentProfile = environmentProfile,
): string {
  const raw = environment.XIAOZHI_UPDATE_SALT;
  if (raw !== undefined && raw !== '') return raw.trim();
  return profileOf(environment).updateSalt ?? '';
}

export function updateFeedDefine(): Plugin {
  const feedUrl = resolveUpdateFeedUrlForBuild();
  const salt = resolveUpdateSaltForBuild();
  return {
    name: 'xiaozhi-update-feed',
    config: () => ({
      define: {
        __UPDATE_FEED_URL__: JSON.stringify(feedUrl),
        __UPDATE_SALT__: JSON.stringify(salt),
      },
    }),
  };
}
