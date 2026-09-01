/**
 * hotel-butler server 地址的构建期注入。
 *
 * ## 为什么不能静默回落
 *
 * 这里原本是 `HOTEL_BUTLER_SERVER_URL ?? 'https://localhost:5173'`——没配就指向
 * 打包者自己的机器。2026-09-01 线上事故就是这么来的：CI 没设该变量，打出的
 * phone 包连的是用户电脑，发验证码与登录全部失败，且失败时只显示笼统文案。
 *
 * `rms-origin.ts` 早就不这么做了：地址未确定就**构建失败**——宁可打不出包，也
 * 不打一个连错后端的包。本文件现在与它对齐。
 *
 * 取值优先级：`HOTEL_BUTLER_SERVER_URL` > 当前环境 profile 的 `serverOrigin`
 * （见 app-env-profiles.mjs）。两者都没有时构建失败，不兜底。
 *
 * ## 谁在用这个地址
 *
 * 登录**不**走这里（那是 RMS，见 rms-origin.ts）。用它的是 AI 助理的 tRPC
 * 调用，以及 `private-ca-trust.ts` 的信任 host 匹配。
 */
import type { Plugin } from 'vite';
import { environmentProfile, resolveAppEnvironment } from './app-env';

export function resolveServerOriginForBuild(
  environment: NodeJS.ProcessEnv = process.env,
  profileOf: typeof environmentProfile = environmentProfile,
): string {
  const raw = environment.HOTEL_BUTLER_SERVER_URL?.trim();
  const configured = raw !== undefined && raw !== '' ? raw : profileOf(environment).serverOrigin;

  if (configured === null || configured === undefined) {
    throw new Error(
      `环境 ${resolveAppEnvironment(environment)} 尚未配置 hotel-butler server 地址。\n` +
        '请在 vite-plugins/app-env-profiles.mjs 的 PROFILES 中填入 serverOrigin，' +
        '或显式设置 HOTEL_BUTLER_SERVER_URL。',
    );
  }

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error(`HOTEL_BUTLER_SERVER_URL 不是合法 URL: ${configured}`);
  }
  if (url.protocol !== 'https:') throw new Error('HOTEL_BUTLER_SERVER_URL must use HTTPS');
  return url.origin;
}

export function serverOriginDefine(): Plugin {
  const origin = resolveServerOriginForBuild();
  return {
    name: 'hotel-butler-server-origin',
    config: () => ({ define: { __SERVER_ORIGIN__: JSON.stringify(origin) } }),
  };
}
