import { describe, expect, it } from 'vitest';
import { getVisibleLocalAdminCredentials } from './local-admin-credentials';

describe('visible local administrator credentials', () => {
	it('shows development credentials and hides production credentials by default', () => {
		expect(getVisibleLocalAdminCredentials({}, true)).toEqual({
			password: 'admin123',
			username: 'admin'
		});
		expect(
			getVisibleLocalAdminCredentials(
				{ INITIAL_ADMIN_PASSWORD: 'production-secret', INITIAL_ADMIN_USERNAME: 'production-admin' },
				false
			)
		).toBeUndefined();
	});

	it('supports an explicit local-container display flag', () => {
		expect(
			getVisibleLocalAdminCredentials(
				{
					INITIAL_ADMIN_PASSWORD: 'local-password',
					INITIAL_ADMIN_USERNAME: 'local-admin',
					SHOW_LOCAL_ADMIN_CREDENTIALS: 'true'
				},
				false
			)
		).toEqual({ password: 'local-password', username: 'local-admin' });
	});
});
