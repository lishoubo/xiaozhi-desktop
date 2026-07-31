import type { CookiesSetDetails } from 'electron';

type JsonCookie = Readonly<Record<string, unknown>>;

const SAME_SITE_VALUES = new Set(['unspecified', 'no_restriction', 'lax', 'strict']);

function asBoolean(value: unknown): boolean {
  return value === true || value === 'TRUE';
}

function normalizeSameSite(value: unknown): CookiesSetDetails['sameSite'] {
  if (typeof value !== 'string') return undefined;
  const normalized = value.toLowerCase().replace('none', 'no_restriction');
  return SAME_SITE_VALUES.has(normalized)
    ? (normalized as CookiesSetDetails['sameSite'])
    : undefined;
}

function normalizeJsonCookie(cookie: JsonCookie): CookiesSetDetails | null {
  if (
    typeof cookie.name !== 'string' ||
    typeof cookie.value !== 'string' ||
    typeof cookie.domain !== 'string'
  ) {
    return null;
  }

  const secure = asBoolean(cookie.secure);
  const path = typeof cookie.path === 'string' ? cookie.path : '/';
  const sameSite = normalizeSameSite(cookie.sameSite);
  const expirationDate =
    typeof cookie.expirationDate === 'number'
      ? cookie.expirationDate
      : typeof cookie.expiration === 'number'
        ? cookie.expiration
        : undefined;

  return {
    url: `${secure ? 'https' : 'http'}://${cookie.domain.replace(/^\./, '')}${path}`,
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path,
    secure,
    httpOnly: asBoolean(cookie.httpOnly),
    ...(expirationDate === undefined ? {} : { expirationDate }),
    ...(sameSite === undefined ? {} : { sameSite }),
  };
}

function parseJson(content: string): CookiesSetDetails[] | null {
  try {
    const parsed: unknown = JSON.parse(content);
    const records = Array.isArray(parsed)
      ? parsed
      : typeof parsed === 'object' &&
          parsed !== null &&
          Array.isArray((parsed as { cookies?: unknown }).cookies)
        ? (parsed as { cookies: unknown[] }).cookies
        : null;
    if (!records) return null;
    return records
      .filter((record): record is JsonCookie => typeof record === 'object' && record !== null)
      .map(normalizeJsonCookie)
      .filter((cookie): cookie is CookiesSetDetails => cookie !== null);
  } catch {
    return null;
  }
}

function parseNetscape(content: string): CookiesSetDetails[] {
  return content
    .split(/\r?\n/)
    .filter((line) => line.trim() && (!line.startsWith('#') || line.startsWith('#HttpOnly_')))
    .map((line): CookiesSetDetails | null => {
      const httpOnly = line.startsWith('#HttpOnly_');
      const fields = line.replace(/^#HttpOnly_/, '').split('\t');
      if (fields.length < 7) return null;
      const [domain, , path, secureValue, expirationValue, name, ...valueParts] = fields;
      const secure = secureValue === 'TRUE';
      const expirationDate = Number(expirationValue);
      if (!domain || !path || !name || !Number.isFinite(expirationDate)) return null;
      return {
        url: `${secure ? 'https' : 'http'}://${domain.replace(/^\./, '')}${path}`,
        name,
        value: valueParts.join('\t'),
        domain,
        path,
        secure,
        httpOnly,
        ...(expirationDate > 0 ? { expirationDate } : {}),
      };
    })
    .filter((cookie): cookie is CookiesSetDetails => cookie !== null);
}

export function parseCookieExport(content: string): CookiesSetDetails[] {
  const cookies = parseJson(content) ?? parseNetscape(content);
  if (cookies.length === 0) {
    throw new Error('没有找到可导入的 Cookie');
  }
  return cookies;
}
