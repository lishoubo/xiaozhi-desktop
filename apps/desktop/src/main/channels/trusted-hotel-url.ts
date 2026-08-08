/**
 * 三渠道共用的 URL 可信域名校验：HTTPS 协议 + 固定 hostname。渠道各自的域名
 * 由调用方传入，这里不硬编码任何渠道信息。
 */
export function isTrustedHotelUrl(url: string, expectedHostname: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === expectedHostname;
  } catch {
    return false;
  }
}
