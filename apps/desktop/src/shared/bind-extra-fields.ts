/**
 * `bindExtra` 里少数**两个进程都要读**的字段。
 *
 * 写入侧（`main/channels/bind-extra.ts`）留在主进程：它要拼渠道原始字段、要认识
 * credential。渲染进程只读其中一个字段，用它决定重新登录走哪条核对路径：
 *
 * ```
 * 有 channelAccountId → 桌面端绑的  → 锚点=账号
 * 无 channelAccountId → RMS 后台绑的 → 锚点=门店
 * ```
 *
 * 放 `shared/` 是因为它是跨进程契约的一部分（判据必须两端一致），且这里零框架
 * 依赖、不认识 main。
 */
import type { JsonObject } from './types/json';

/** 读绑定上下文里的渠道账号标识；RMS 后台绑定的老记录没有这个字段，返回 null。 */
export function channelAccountIdFromBindExtra(bindExtra: JsonObject | null): string | null {
  if (bindExtra === null) return null;
  const value = bindExtra.channelAccountId;
  return typeof value === 'string' && value.length > 0 ? value : null;
}
