/**
 * 用 `session.cookies.get({})` 采集 —— **降级路径**，CDP 不可用时的兜底。
 *
 * 拿不到 `partitionKey`（Electron 43 的 `Cookie` 结构里没有这个字段），所以分区
 * cookie 与非分区同名 cookie 在远端会塌缩成一条。但其余属性都补齐了，尤其
 * `expirationDate` —— 只上送三字段时远端把**全部** cookie 当会话 cookie 处理，
 * 补上有效期这一项本身就可能显著延长登录态寿命。
 *
 * 降级快照不完美，但显著优于现状，且绝不能让绑定流程失败（见 design 决策 1）。
 */
import type { Session } from 'electron';
import type { CollectedCookie } from './to-snapshot-entry';

/**
 * Electron 的 `sameSite` 值域与 CDP 不同（`no_restriction` / `lax` / `strict` /
 * `unspecified`），映射由 `to-snapshot-entry` 的 `'electron'` dialect 负责 ——
 * 本函数只负责搬运，不在这里翻译，避免两条路径各有一套规则。
 *
 * 会话 cookie 在 Electron 下表现为**没有 `expirationDate` 字段**，不是 -1；
 * `session` 字段照样透传，映射层两个条件都看。
 */
export async function collectViaElectronSession(
  session: Session,
): Promise<readonly CollectedCookie[]> {
  const cookies = await session.cookies.get({});

  return cookies.map((cookie) => ({
    name: cookie.name,
    value: cookie.value,
    ...(cookie.domain !== undefined ? { domain: cookie.domain } : {}),
    ...(cookie.path !== undefined ? { path: cookie.path } : {}),
    ...(cookie.secure !== undefined ? { secure: cookie.secure } : {}),
    ...(cookie.httpOnly !== undefined ? { httpOnly: cookie.httpOnly } : {}),
    ...(cookie.sameSite !== undefined ? { sameSite: cookie.sameSite } : {}),
    ...(cookie.expirationDate !== undefined ? { expires: cookie.expirationDate } : {}),
    ...(cookie.session !== undefined ? { session: cookie.session } : {}),
    // partitionKey 刻意不出现：Electron 根本不提供，这正是降级的代价
  }));
}
