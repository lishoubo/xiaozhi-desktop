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
 * 明文 HTTP 需要 `XIAOZHI_ALLOW_INSECURE_RMS=1` 显式豁免：JWT 是明文可用的凭证，
 * 裸奔出本机就有被劫持的风险。把豁免做成必须写在命令行上的开关，是为了让
 * "这个包是不安全的"这件事在事后可追溯，而不是藏在某个配置默认值里。
 */
import type { Plugin } from 'vite';

const DEFAULT_RMS_ORIGIN = 'http://localhost:8080';

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

export function resolveRmsOriginForBuild(environment: NodeJS.ProcessEnv = process.env): string {
  const raw = environment.XIAOZHI_RMS_SERVER_URL;
  if (raw === undefined || raw === '') return DEFAULT_RMS_ORIGIN;

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
