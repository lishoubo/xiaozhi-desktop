import { describe, expect, it } from 'vitest';
import { isAdministrator } from './admin-access';

const administrator: App.AuthUser = {
	createdAt: new Date('2026-08-05T00:00:00Z'),
	email: 'admin@example.invalid',
	emailVerified: false,
	id: 'admin-id',
	name: 'Administrator',
	updatedAt: new Date('2026-08-05T00:00:00Z'),
	username: 'admin'
};

describe('administrator access', () => {
	it('treats every authenticated admin identity as an administrator', () => {
		expect(isAdministrator(administrator)).toBe(true);
		expect(isAdministrator(undefined)).toBe(false);
	});
});
