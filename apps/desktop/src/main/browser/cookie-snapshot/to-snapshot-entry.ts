/**
 * 两条采集路径（CDP / Electron API）共用的字段映射 —— **本模块是本次改动的正确性核心**。
 *
 * 单独抽成不依赖 Electron 的纯函数，是因为省略规则是最容易写错的地方，而写错的后果
 * 在运行时完全静默：快照照常上送，登录态照常残缺，日志上与「一切正常」一模一样。
 * 抽出来才能脱离 Electron 裸测每一条规则。
 *
 * 三条规则（来自 `specs/ota-cookie-snapshot/spec.md`）：
 *
 * 1. **缺省即省略 key**，不传 `null`、更不补默认值
 * 2. **会话 cookie 省略 `expires`**，不传 -1 或 0
 * 3. **`partitionKey` 原样透传**，不解析不归一化
 */
import type { RmsCookieSnapshotEntry } from '../../gateway/rms/types';

/**
 * Electron `Cookie.sameSite` 的值域 → 上送值域。
 *
 * `unspecified` **必须省略字段而非补 `"Lax"`**：未设置时浏览器走默认策略，与显式声明
 * `Lax` 是两种不同行为；补默认值会让本该跨站携带的登录态不再被携带。
 *
 * CDP 直接给出 `None` / `Lax` / `Strict`，不经过这张表。
 */
const ELECTRON_SAME_SITE: Readonly<Record<string, RmsCookieSnapshotEntry['sameSite']>> = {
  no_restriction: 'None',
  lax: 'Lax',
  strict: 'Strict',
  // unspecified 刻意不在表里 —— 查不到即省略
};

/** CDP 给出的合法值域；其余一律当作「未设置」省略。 */
const CDP_SAME_SITE = new Set(['None', 'Lax', 'Strict']);

/**
 * 采集来源交给映射层的中间形状 —— 两条路径各自把自己的原始返回归一到这里。
 *
 * 只描述「来源给了什么」，不含任何省略判断：省略是本模块的职责。
 */
export type CollectedCookie = Readonly<{
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  /** Electron 值域或 CDP 值域皆可，由 `sameSiteDialect` 指明怎么读。 */
  sameSite?: string;
  /** epoch 秒。CDP 用 -1 表示会话 cookie；Electron 对会话 cookie 直接不给此字段。 */
  expires?: number;
  /** CDP 的 `session` 字段。为 true 时必定省略 `expires`。 */
  session?: boolean;
  partitionKey?: unknown;
}>;

export type SameSiteDialect = 'cdp' | 'electron';

function toSameSite(
  raw: string | undefined,
  dialect: SameSiteDialect,
): RmsCookieSnapshotEntry['sameSite'] {
  if (!raw) return undefined;
  if (dialect === 'electron') return ELECTRON_SAME_SITE[raw];
  return CDP_SAME_SITE.has(raw) ? (raw as RmsCookieSnapshotEntry['sameSite']) : undefined;
}

/**
 * 会话 cookie 判定：CDP 的 `session: true`，或没有正数过期时间。
 *
 * 两个条件都要看 —— CDP 会同时给 `session: true` 和 `expires: -1`，而 Electron 对会话
 * cookie 是直接不给 `expirationDate`。任一成立即省略 `expires`。
 */
function toExpires(cookie: CollectedCookie): number | undefined {
  if (cookie.session === true) return undefined;
  if (typeof cookie.expires !== 'number') return undefined;
  return cookie.expires > 0 ? cookie.expires : undefined;
}

/**
 * 把一条采集结果映射成上送条目。
 *
 * ⚠️ 全程用条件展开 `...(x ? { k: x } : {})` 而不是直接赋值：赋 `undefined` 虽然也会被
 * `JSON.stringify` 丢掉，但条件展开让「这个 key 可能整个不存在」在代码里显式可见，
 * 后来人不会以为可以安全地读 `entry.sameSite`。
 */
export function toSnapshotEntry(
  cookie: CollectedCookie,
  dialect: SameSiteDialect,
): RmsCookieSnapshotEntry {
  const sameSite = toSameSite(cookie.sameSite, dialect);
  const expires = toExpires(cookie);

  return {
    name: cookie.name,
    value: cookie.value,
    // domain 是必填字段，来源缺失时退回空串（与改造前一致，不改变既有行为）
    domain: cookie.domain ?? '',
    ...(cookie.path !== undefined ? { path: cookie.path } : {}),
    ...(cookie.secure !== undefined ? { secure: cookie.secure } : {}),
    ...(cookie.httpOnly !== undefined ? { httpOnly: cookie.httpOnly } : {}),
    ...(sameSite !== undefined ? { sameSite } : {}),
    ...(expires !== undefined ? { expires } : {}),
    // 原样搬运：null / undefined 视为「没有分区键」而省略，其余一切形态（对象、
    // 字符串、将来 Chrome 换的任何形状）不做任何处理直接透传。
    ...(cookie.partitionKey != null ? { partitionKey: cookie.partitionKey } : {}),
  };
}
