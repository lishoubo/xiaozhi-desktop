/**
 * cookie 导入的作用域策略 —— 导入哪个渠道，就只读哪个渠道的域。
 *
 * 这是 D2 的修复：此前 `isSupportedCookieDomain` 硬编码 13 个域名，
 * 用户点「导入携程」时会把小红书、抖音、淘宝的 cookie 一并读走。
 * 那既是隐私问题（读取无关站点的登录凭证），也让 cookie 落到错误的 session。
 *
 * 域名清单的权威在 ChannelManifest.cookieDomains，本模块只提供匹配规则。
 */

/**
 * cookie 的 host 是否属于给定域集合。
 *
 * 匹配规则：完全相等，或是其子域。**必须带点比较子域**，否则
 * `evilctrip.com` 会被 `endsWith('ctrip.com')` 误判为携程的域。
 */
export function isCookieHostInScope(host: string, domains: readonly string[]): boolean {
  const normalized = normalizeHost(host);
  if (normalized.length === 0) return false;
  return domains.some((domain) => {
    const target = normalizeHost(domain);
    if (target.length === 0) return false;
    return normalized === target || normalized.endsWith(`.${target}`);
  });
}

/** cookie 的 host_key 可能带前导点（`.ctrip.com`），统一去掉再比较。 */
function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/^\./, '');
}
