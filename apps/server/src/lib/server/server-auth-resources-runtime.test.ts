import type { EmployeeIdentityDirectory, PhoneOtpGateway } from '@hotel-butler/api';
import { describe, expect, it, vi } from 'vitest';
import type { ServerAuthResources } from './server-auth-resources';
import { createAuthResourcesRuntime } from './server-auth-resources-runtime';

const employeeDirectory: EmployeeIdentityDirectory = {
	findActiveById: vi.fn().mockResolvedValue(null),
	findActiveByPhone: vi.fn().mockResolvedValue(null)
};
const phoneOtp: PhoneOtpGateway = {
	requestCode: vi.fn().mockResolvedValue({ expiresInSeconds: 300 }),
	verifyCode: vi.fn().mockResolvedValue(true)
};

function resources(phoneIdentitySourceConfigured: boolean): ServerAuthResources {
	return { employeeDirectory, phoneIdentitySourceConfigured, phoneOtp };
}

describe('server authentication resources runtime', () => {
	it('retries a configured RMS source in the background without blocking requests', async () => {
		let timestamp = 0;
		let completeRetry: ((value: ServerAuthResources) => void) | undefined;
		const load = vi
			.fn<(options: Readonly<{ reportFailure: boolean }>) => Promise<ServerAuthResources>>()
			.mockResolvedValueOnce(resources(false))
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						completeRetry = resolve;
					})
			);
		const initialize = createAuthResourcesRuntime({
			isRmsConfigured: () => true,
			load,
			now: () => timestamp,
			retryDelayMs: 1_000
		});

		await expect(initialize()).resolves.toMatchObject({ phoneIdentitySourceConfigured: false });
		expect(load).toHaveBeenLastCalledWith({ reportFailure: true });
		timestamp = 999;
		await expect(initialize()).resolves.toMatchObject({ phoneIdentitySourceConfigured: false });
		timestamp = 1_000;
		await expect(initialize()).resolves.toMatchObject({ phoneIdentitySourceConfigured: false });
		expect(load).toHaveBeenLastCalledWith({ reportFailure: false });
		const waitingForPhoneIdentity = initialize({ waitForRetry: true });
		completeRetry?.(resources(true));
		await expect(waitingForPhoneIdentity).resolves.toMatchObject({
			phoneIdentitySourceConfigured: true
		});
		timestamp = 10_000;
		await expect(initialize()).resolves.toMatchObject({ phoneIdentitySourceConfigured: true });
		expect(load).toHaveBeenCalledTimes(2);
	});

	it('does not repeatedly initialize an intentionally unconfigured RMS source', async () => {
		const load = vi.fn(async () => resources(false));
		const initialize = createAuthResourcesRuntime({
			isRmsConfigured: () => false,
			load,
			retryDelayMs: 0
		});

		await initialize();
		await initialize();

		expect(load).toHaveBeenCalledOnce();
	});

	it('reports an unexpected background loader rejection while retaining the fallback', async () => {
		let timestamp = 0;
		const failure = new Error('unexpected loader failure');
		const reportUnexpectedFailure = vi.fn();
		const load = vi
			.fn<(options: Readonly<{ reportFailure: boolean }>) => Promise<ServerAuthResources>>()
			.mockResolvedValueOnce(resources(false))
			.mockRejectedValueOnce(failure);
		const initialize = createAuthResourcesRuntime({
			isRmsConfigured: () => true,
			load,
			now: () => timestamp,
			retryDelayMs: 1,
			reportUnexpectedFailure
		});

		await initialize();
		timestamp = 1;
		await expect(initialize({ waitForRetry: true })).resolves.toMatchObject({
			phoneIdentitySourceConfigured: false
		});
		expect(reportUnexpectedFailure).toHaveBeenCalledWith(failure);
	});
});
