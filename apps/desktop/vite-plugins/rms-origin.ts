/**
 * RMS 服务端地址的构建期注入。
 *
 * 为什么不留给运行时 `process.env`：打包产物是被双击启动的，父进程环境里没有
 * `XIAOZHI_RMS_SERVER_URL`，运行时读取会静默兜底到 localhost——打出一个
 * "看起来正常、却连着本机"的包。地址必须在构建时就烧进产物。
 *
 * 与 auth-variant 的差别：RMS 地址只有主进程用得到，所以只挂在 vite.main.config.ts
 * 一处，不必三个构建都注入。
 *
 * 取值优先级：`XIAOZHI_RMS_SERVER_URL` > 当前环境的 profile 默认值（见 app-env.ts）。
 * profile 默认值为 `null`（地址未确定）且未显式指定时，**构建失败**——不兜底。
 *
 * 明文 HTTP 需要 `XIAOZHI_ALLOW_INSECURE_RMS=1` 显式豁免：JWT 是明文可用的凭证，
 * 裸奔出本机就有被劫持的风险。把豁免做成必须写在命令行上的开关，是为了让
 * "这个包是不安全的"这件事在事后可追溯，而不是藏在某个配置默认值里。
 */
import { environmentProfile, resolveAppEnvironment } from './app-env';
import type { Plugin } from 'vite';

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

/**
 * `profileOf` 只为测试留的接缝：「地址未确定就构建失败」是本函数的固有规则，但
 * PROFILES 里三个环境当前都填了地址，没有环境能触发它。注入一个 `rmsOrigin` 为
 * null 的 profile 才能测到这条规则，且不必为此把某个真实环境改回 null。
 */
export function resolveRmsOriginForBuild(
  environment: NodeJS.ProcessEnv = process.env,
  profileOf: typeof environmentProfile = environmentProfile,
): string {
  const raw = environment.XIAOZHI_RMS_SERVER_URL;
  if (raw === undefined || raw === '') {
    // 未显式指定则取该环境的默认地址（见 app-env.ts 的 PROFILES）。
    const { rmsOrigin } = profileOf(environment);
    if (rmsOrigin === null) {
      // 该环境的地址尚未确定。**不填占位地址、不兜底 localhost**：打出一个连着
      // 错误后端的包，比构建失败危险得多。
      throw new Error(
        `环境 ${resolveAppEnvironment(environment)} 尚未配置默认 RMS 地址。\n` +
          '请在 vite-plugins/app-env.ts 的 PROFILES 中填入，或显式设置 XIAOZHI_RMS_SERVER_URL。',
      );
    }
    return rmsOrigin;
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`XIAOZHI_RMS_SERVER_URL 不是合法 URL: ${raw}`);
  }

  if (url.protocol !== 'https:' && !isLoopback(url.hostname)) {
    // 不做默认回退：静默降级会打出一个凭证裸奔的包。
    if (environment.XIAOZHI_ALLOW_INSECURE_RMS !== '1') {
      throw new Error(
        `远端 RMS 地址必须使用 HTTPS: ${url.origin}\n` +
          '确需打明文 HTTP 包时，显式设置 XIAOZHI_ALLOW_INSECURE_RMS=1。',
      );
    }
  }

  return url.origin;
}

export function rmsOriginDefine(): Plugin {
  const origin = resolveRmsOriginForBuild();
  return {
    name: 'xiaozhi-rms-origin',
    config: () => ({
      define: { __RMS_ORIGIN__: JSON.stringify(origin) },
    }),
  };
}
