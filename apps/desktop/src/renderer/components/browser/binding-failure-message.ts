/**
 * 绑定失败时给用户看的文案。
 *
 * 远端的业务拒绝（如「该酒店的此渠道已存在活跃绑定」）重试永远不会成功，统一
 * 说「请重试」会让用户白试，所以要把真实原因透出来。但 Electron 会把主进程抛
 * 的错包成 `Error invoking remote method 'x': Error: 真实文案`，直接显示会把
 * IPC 频道名漏到界面上——这里剥掉包装只留最后一段。
 */
const FALLBACK = '绑定失败，请重试。';

export function bindingFailureMessage(reason: unknown): string {
  if (!(reason instanceof Error) || !reason.message) return FALLBACK;
  const unwrapped = reason.message.replace(/^Error invoking remote method '[^']*':\s*/, '');
  const withoutErrorPrefix = unwrapped.replace(/^(?:Error|TypeError):\s*/, '').trim();
  return withoutErrorPrefix || FALLBACK;
}
