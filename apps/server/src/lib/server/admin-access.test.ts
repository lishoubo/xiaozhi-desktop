import { describe, expect, it } from 'vitest';
import { isSuperAdmin } from './admin-access';

describe('super administrator access', () => {
	it('accepts the configured superAdmin role', () => {
		expect(isSuperAdmin({ role: 'superAdmin' } as App.AuthUser)).toBe(true);
		expect(isSuperAdmin({ role: 'user,superAdmin' } as App.AuthUser)).toBe(true);
	});

	it('rejects missing and regular user roles', () => {
		expect(isSuperAdmin(undefined)).toBe(false);
		expect(isSuperAdmin({ role: 'user' } as App.AuthUser)).toBe(false);
	});
});
