/**
 * 把值还原成可结构化克隆的纯 JSON 数据。
 *
 * **为什么需要**：Svelte 的 `$state` 把对象包成 Proxy，而 Electron 的 contextBridge
 * 用结构化克隆传参——克隆 Proxy 会抛 `An object could not be cloned`。这个错误是在
 * **调用参数求值时同步抛出**的，不是 Promise 拒绝，所以调用方的 `.catch()` 拦不住；
 * 若与其他请求并排在 `Promise.all` 里，会把整批一起带崩。
 *
 * 典型来源是远端响应里的开放字段（如 OTA 绑定的 `bindExtra`）：它们经 zod 解析后
 * 进入组件状态，再原样传回主进程时就会踩中。
 */
export function toPlainJson<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value)) as T;
}
