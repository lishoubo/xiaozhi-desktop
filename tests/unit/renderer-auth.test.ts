import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthSession, readAuthSession } from '../../src/renderer/auth';

const AUTH_STORAGE_KEY = 'hotel-butler.auth-session';

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', createStorage());
});

describe('auth session validation', () => {
  it('round-trips a valid session', () => {
    const session = createAuthSession('13800138000', 1_000);

    expect(session).toEqual({ phone: '13800138000', expiresAt: 604_801_000 });
    expect(readAuthSession(2_000)).toEqual(session);
  });

  it.each([
    { phone: 'guest', expiresAt: 2_000 },
    { phone: '13800138000', expiresAt: 'never' },
    { phone: '13800138000', expiresAt: Number.NaN },
    { phone: '13800138000', expiresAt: 2_000, elevated: true },
  ])('removes a malformed stored session: %o', (value) => {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(value));

    expect(readAuthSession(1_000)).toBeNull();
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
  });
});
