/**
 * 解析 rms-server 地址。
 *
 * 取值和校验都在构建期完成（见 vite-plugins/rms-origin.ts）：`__RMS_ORIGIN__`
 * 是被 Rollup 折叠掉的字面量。刻意不在运行时读 `process.env`——打包产物是被
 * 双击启动的，父进程环境里没有那个变量，运行时读取会静默兜底到 localhost，
 * 打出一个"看起来正常、却连着本机"的包。
 *
 * 也刻意不复用 `server-client/config.ts` 的 `resolveServerOrigin`：那个强制
 * https，而 rms-server 本地默认跑在 `http://localhost:8080`（无 TLS）。
 */
export function resolveRmsOrigin(): string {
  return __RMS_ORIGIN__;
}
