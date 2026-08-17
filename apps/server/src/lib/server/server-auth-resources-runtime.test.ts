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
	it('retries a configured RMS source after the cooldown and caches the first verified pool', async () => {
		let timestamp = 0;
		const load = vi
			.fn<() => Promise<ServerAuthResources>>()
			.mockResolvedValueOnce(resources(false))
			.mockResolvedValueOnce(resources(true));
		const initialize = createAuthResourcesRuntime({
			isRmsConfigured: () => true,
			load,
			now: () => timestamp,
			retryDelayMs: 1_000
		});

		await expect(initialize()).resolves.toMatchObject({ phoneIdentitySourceConfigured: false });
		timestamp = 999;
		await expect(initialize()).resolves.toMatchObject({ phoneIdentitySourceConfigured: false });
		timestamp = 1_000;
		await expect(initialize()).resolves.toMatchObject({ phoneIdentitySourceConfigured: true });
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
});
