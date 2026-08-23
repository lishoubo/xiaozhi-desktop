import type { ApiLogger } from '@hotel-butler/api/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PhoneOtpGateway } from './desktop-api-endpoint';
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
	beforeEach(() => vi.clearAllMocks());

	it('keeps phone authentication registered without creating an RMS pool when no URL is configured', async () => {
		const createRmsClient = vi.fn();
		const createPhoneOtp = vi.fn(() => phoneOtp);
		const resources = await createServerAuthResources({
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
		await expect(
			resources.employeeHotelAccessDirectory.findByEmployeeId('1', '42')
		).rejects.toThrow('RMS employee hotel access source is not configured');
	});

	it('advertises the RMS employee directory only after the read-only startup check succeeds', async () => {
		const execute = vi.fn().mockResolvedValue([[{ connectivity_check: 1 }], []]);
		const end = vi.fn().mockResolvedValue(undefined);
		const createRmsClient = vi.fn(() => ({ execute, end }));
		const now = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(112);
		const resources = await createServerAuthResources({
			environment: {
				RMS_DATABASE_URL: 'mysql://readonly@example.invalid/rms'
			},
			logger,
			createRmsClient,
			createPhoneOtp: vi.fn(() => phoneOtp),
			now
		});

		expect(resources.phoneIdentitySourceConfigured).toBe(true);
		expect(createRmsClient).toHaveBeenCalledWith('mysql://readonly@example.invalid/rms');
		expect(execute).toHaveBeenCalledWith('SELECT 1', []);
		expect(end).not.toHaveBeenCalled();
		expect(logger.info).toHaveBeenCalledWith(
			expect.objectContaining({ event: 'rms.connection.verified', durationMs: 12 }),
			'RMS connection verified'
		);
	});

	it('keeps RMS unavailable and logs only safe diagnostics when startup verification fails', async () => {
		const failure = Object.assign(new Error('Access denied for readonly with password=private'), {
			code: 'ER_ACCESS_DENIED_ERROR'
		});
		const execute = vi.fn().mockRejectedValue(failure);
		const end = vi.fn().mockResolvedValue(undefined);
		const resources = await createServerAuthResources({
			environment: {
				RMS_DATABASE_URL: 'mysql://readonly:private@example.invalid/rms'
			},
			logger,
			createRmsClient: vi.fn(() => ({ execute, end })),
			createPhoneOtp: vi.fn(() => phoneOtp),
			now: vi.fn().mockReturnValueOnce(50).mockReturnValueOnce(65)
		});

		expect(resources.phoneIdentitySourceConfigured).toBe(false);
		expect(end).toHaveBeenCalledOnce();
		expect(logger.error).toHaveBeenCalledWith(
			{
				durationMs: 15,
				errorCode: 'ER_ACCESS_DENIED_ERROR',
				errorType: 'Error',
				event: 'rms.connection.failed'
			},
			'RMS connection verification failed'
		);
		const serializedLogs = JSON.stringify({
			info: logger.info.mock.calls,
			warn: logger.warn.mock.calls,
			error: logger.error.mock.calls
		});
		expect(serializedLogs).not.toContain('private');
		expect(serializedLogs).not.toContain('readonly@example.invalid');
	});

	it('suppresses repeated unavailable diagnostics during a background retry', async () => {
		const execute = vi
			.fn()
			.mockRejectedValue(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }));
		const resources = await createServerAuthResources({
			environment: { RMS_DATABASE_URL: 'mysql://readonly:private@example.invalid/rms' },
			logger,
			createRmsClient: vi.fn(() => ({ execute, end: vi.fn().mockResolvedValue(undefined) })),
			createPhoneOtp: vi.fn(() => phoneOtp),
			reportFailure: false
		});

		expect(resources.phoneIdentitySourceConfigured).toBe(false);
		expect(logger.error).not.toHaveBeenCalled();
		expect(logger.info).not.toHaveBeenCalled();
	});
});
