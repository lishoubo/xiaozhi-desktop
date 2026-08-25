import { toChannelId, type ChannelId } from '../ids';

/**
 * 渠道 → cookie 域名的最小映射。**不是完整的 `ChannelManifest`**（design.md
 * 明确排除，见 Non-Goals）——只覆盖本次要落地的渠道：抖音（真实探测）、
 * 携程/美团（占位，探测未实现）。其余渠道的 cookie 本次不导入。
 */
const CHANNEL_COOKIE_DOMAINS: Readonly<Record<string, readonly string[]>> = {
  douyin: ['douyin.com'],
  ctrip: ['ctrip.com'],
  meituan: ['meituan.com'],
};

const CHROMIUM_TO_UNIX_SECONDS = 11_644_473_600;

/** 给定 cookie 的域名，判断它属于哪个受支持渠道；不属于任何渠道则返回 null。 */
export function channelForCookieDomain(domain: string): ChannelId | null {
  const normalized = domain.trim().toLowerCase().replace(/^\./, '');
  for (const [channel, domains] of Object.entries(CHANNEL_COOKIE_DOMAINS)) {
    if (
      domains.some((supported) => normalized === supported || normalized.endsWith(`.${supported}`))
    ) {
      return toChannelId(channel);
    }
  }
  return null;
}

export function isSupportedCookieDomain(domain: string): boolean {
  return channelForCookieDomain(domain) !== null;
}

export function chromiumTimestampToUnix(value: number): number | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  const unixSeconds = value / 1_000_000 - CHROMIUM_TO_UNIX_SECONDS;
  return unixSeconds > 0 ? unixSeconds : undefined;
}

export function friendlyCookieImportMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/应用绑定加密|app.?bound|v20/i.test(message)) {
    return '该浏览器暂不支持自动导入，请尝试其他浏览器';
  }
  if (/没有找到|未找到|no cookies?/i.test(message)) {
    return '没有找到可导入的 Cookie';
  }
  if (
    /denied|not allowed|cancel(?:led|ed)?|permission|keychain|password|passphrase|eperm|eacces|权限|密码|拒绝|不允许访问/i.test(
      message,
    )
  ) {
    return '无法读取浏览器 Cookie，请允许访问后重试';
  }
  /**
   * Windows 上解 Chromium 主密钥要经 PowerShell 调 DPAPI，这条路失败的表现是
   * `Command failed: ...powershell.exe` 或 `spawn powershell.exe ENOENT`——两者
   * 都不含上面任何一个关键词，此前只能落到最后的兜底文案，用户与我们都看不出
   * 是哪一步出的问题。放在权限分支**之后**：DPAPI 也可能因权限被拒，那种情况
   * 让更具体的权限提示先命中。
   */
  if (/powershell|dpapi|protecteddata/i.test(message)) {
    return '无法解密浏览器 Cookie，请确认使用的是当前 Windows 账户登录的浏览器';
  }
  return 'Cookie 导入失败，请稍后重试';
}
