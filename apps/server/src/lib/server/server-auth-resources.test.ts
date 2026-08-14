import type { ApiLogger, PhoneOtpGateway } from '@hotel-butler/api';
import { describe, expect, it, vi } from 'vitest';
import { createServerAuthResources } from './server-auth-resources';

const logger = {
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn()
} satisfies ApiLogger;

const phoneOtp: PhoneOtpGateway = {
	requestCode: vi.fn().mockResolvedValue({ expiresInSeconds: 300 }),
	verifyCode: vi.fn().mockResolvedValue(true)
};

describe('server authentication resources', () => {
	it('keeps phone authentication registered without creating an RMS pool when no URL is configured', async () => {
		const createRmsClient = vi.fn();
		const createPhoneOtp = vi.fn(() => phoneOtp);
		const resources = createServerAuthResources({
			environment: {},
			logger,
			createRmsClient,
			createPhoneOtp
		});

		expect(resources.phoneIdentitySourceConfigured).toBe(false);
		expect(createRmsClient).not.toHaveBeenCalled();
		expect(createPhoneOtp).toHaveBeenCalledOnce();
		await expect(resources.employeeDirectory.findActiveByPhone('13800138000')).rejects.toThrow(
			'RMS employee identity source is not configured'
		);
	});

	it('creates the RMS employee directory only when RMS_DATABASE_URL is configured', () => {
		const createRmsClient = vi.fn(() => ({ execute: vi.fn() }));
		const resources = createServerAuthResources({
			environment: {
				RMS_DATABASE_URL: 'mysql://readonly@example.invalid/rms'
			},
			logger,
			createRmsClient,
			createPhoneOtp: vi.fn(() => phoneOtp)
		});

		expect(resources.phoneIdentitySourceConfigured).toBe(true);
		expect(createRmsClient).toHaveBeenCalledWith('mysql://readonly@example.invalid/rms');
	});
});
