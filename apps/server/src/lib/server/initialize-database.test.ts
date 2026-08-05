import { describe, expect, it } from 'vitest';
import {
	readInitialAdminConfig,
	temporaryEmailForUsername
} from '../../../scripts/initialize-database';

describe('initial administrator configuration', () => {
	it('accepts simple local credentials without exposing the username in the temporary email', () => {
		const config = readInitialAdminConfig({
			INITIAL_ADMIN_NAME: 'Administrator',
			INITIAL_ADMIN_PASSWORD: 'admin123',
			INITIAL_ADMIN_USERNAME: 'admin'
		});

		expect(config).toEqual({ name: 'Administrator', password: 'admin123', username: 'admin' });
		expect(temporaryEmailForUsername(config.username)).not.toContain('admin@');
	});

	it('rejects an invalid username', () => {
		expect(() =>
			readInitialAdminConfig({
				INITIAL_ADMIN_NAME: 'Administrator',
				INITIAL_ADMIN_PASSWORD: 'admin123',
				INITIAL_ADMIN_USERNAME: 'not valid'
			})
		).toThrow('INITIAL_ADMIN_USERNAME must contain 3-30 lowercase letters');
	});

	it('requires explicit strong credentials in production', () => {
		expect(() => readInitialAdminConfig({ NODE_ENV: 'production' })).toThrow(
			'Production requires INITIAL_ADMIN_USERNAME, INITIAL_ADMIN_PASSWORD, and INITIAL_ADMIN_NAME'
		);
		expect(() =>
			readInitialAdminConfig({
				INITIAL_ADMIN_NAME: 'Administrator',
				INITIAL_ADMIN_PASSWORD: 'weak-password',
				INITIAL_ADMIN_USERNAME: 'production_admin',
				NODE_ENV: 'production'
			})
		).toThrow('Production administrator credentials do not meet the strength requirements');
	});
});
