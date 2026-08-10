const DEFAULT_RMS_ORIGIN = 'http://localhost:8080';

/**
 * 解析 rms-server 地址。
 *
 * 刻意不复用 `server-client/config.ts` 的 `resolveServerOrigin`：那个强制 https，
 * 而 rms-server 本地默认跑在 `http://localhost:8080`（无 TLS）。这里放宽到
 * 「loopback 允许 http，其余一律要求 https」——JWT 是明文可用的凭证，
 * 出了本机就不能裸奔。
 */
export function resolveRmsOrigin(environment: NodeJS.ProcessEnv): string {
  const url = new URL(environment.XIAOZHI_RMS_SERVER_URL ?? DEFAULT_RMS_ORIGIN);
  const isLoopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';

  if (url.protocol !== 'https:' && !isLoopback) {
    throw new Error('远端 RMS 地址必须使用 HTTPS');
  }

  return url.origin;
}
