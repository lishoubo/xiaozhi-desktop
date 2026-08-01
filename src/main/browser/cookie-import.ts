const SUPPORTED_COOKIE_DOMAINS = [
  'agoda.com',
  'alibaba.com',
  'booking.com',
  'bytedance.com',
  'ctrip.com',
  'douyin.com',
  'expedia.com',
  'fliggy.com',
  'meituan.com',
  'taobao.com',
  'trip.com',
  'tujia.com',
  'xiaohongshu.com',
] as const;

const CHROMIUM_TO_UNIX_SECONDS = 11_644_473_600;

export function isSupportedCookieDomain(domain: string): boolean {
  const normalized = domain.trim().toLowerCase().replace(/^\./, '');
  return SUPPORTED_COOKIE_DOMAINS.some(
    (supported) => normalized === supported || normalized.endsWith(`.${supported}`),
  );
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
  return 'Cookie 导入失败，请稍后重试';
}
