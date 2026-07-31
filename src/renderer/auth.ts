const AUTH_STORAGE_KEY = 'hotel-butler.auth-session';
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export const MOCK_PHONE = '13800138000';
export const MOCK_CODE = '123456';
export const CODE_DURATION_MS = 5 * 60 * 1000;

export type AuthSession = Readonly<{
  phone: string;
  expiresAt: number;
}>;

export function createAuthSession(phone: string, now = Date.now()): AuthSession {
  const session = { phone, expiresAt: now + SESSION_DURATION_MS };
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  return session;
}

export function readAuthSession(now = Date.now()): AuthSession | null {
  try {
    const value = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<AuthSession>;
    if (
      typeof parsed.phone !== 'string' ||
      typeof parsed.expiresAt !== 'number' ||
      parsed.expiresAt <= now
    ) {
      clearAuthSession();
      return null;
    }
    return { phone: parsed.phone, expiresAt: parsed.expiresAt };
  } catch {
    clearAuthSession();
    return null;
  }
}

export function clearAuthSession(): void {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

export function maskPhone(phone: string): string {
  return phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
}
