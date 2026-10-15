const CHROME_MAJOR = 155;

function platformToken(platform: NodeJS.Platform): string {
  if (platform === 'darwin') return 'Macintosh; Intel Mac OS X 10_15_7';
  if (platform === 'win32') return 'Windows NT 10.0; Win64; x64';
  return 'X11; Linux x86_64';
}

function chromeUserAgent(platform: NodeJS.Platform, version: string): string {
  return (
    `Mozilla/5.0 (${platformToken(platform)}) AppleWebKit/537.36 ` +
    `(KHTML, like Gecko) Chrome/${version} Safari/537.36`
  );
}

/** 已在本地携程页面验证过的 Chrome 主版本。 */
export function defaultBrowserUserAgent(platform: NodeJS.Platform): string {
  return chromeUserAgent(platform, `${CHROME_MAJOR}.0.0.0`);
}

/** Profile 版本只能推导标准 UA；不能还原用户自行修改过的 UA。 */
export function browserUserAgentFromVersion(
  source: 'chrome' | 'edge',
  version: string,
  platform: NodeJS.Platform,
): string | null {
  if (!/^\d{1,3}(?:\.\d{1,5}){3}$/.test(version)) return null;
  const major = Number(version.split('.')[0]);
  if (major < 1) return null;
  const base = chromeUserAgent(platform, `${major}.0.0.0`);
  return source === 'edge' ? `${base} Edg/${version}` : base;
}

/** 磁盘元数据来自旧版本或用户文件时，不允许任意 HTTP 头内容进入请求。 */
export function safeBrowserUserAgent(value: unknown): string | null {
  return typeof value === 'string' &&
    value.length >= 20 &&
    value.length <= 512 &&
    /^[\x20-\x7e]+$/.test(value) &&
    value.startsWith('Mozilla/5.0 ')
    ? value
    : null;
}
