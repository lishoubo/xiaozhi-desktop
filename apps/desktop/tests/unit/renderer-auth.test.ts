import { beforeEach, describe, expect, it } from 'vitest';
import { clearAuthSession, readAuthSession, setAuthSession } from '../../src/renderer/auth';

const employee = {
  id: '2',
  orgId: '42',
  username: 'desktop-demo',
  fullName: '桌面体验员工',
  phone: '13800138000',
  roleCode: 'FRONT_DESK',
} as const;

beforeEach(() => {
  clearAuthSession();
});

describe('renderer auth identity', () => {
  it('keeps only safe employee identity in memory', () => {
    setAuthSession(employee);

    expect(readAuthSession()).toEqual(employee);
  });

  it('clears the in-memory identity', () => {
    setAuthSession(employee);

    clearAuthSession();

    expect(readAuthSession()).toBeNull();
  });
});
