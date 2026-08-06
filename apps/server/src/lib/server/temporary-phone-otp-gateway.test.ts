import { describe, expect, it, vi } from 'vitest';
import { createTemporaryPhoneOtpGateway } from './temporary-phone-otp-gateway';

describe('temporary phone OTP gateway', () => {
	it('accepts requests and every schema-valid six-digit code until a provider is selected', async () => {
		const warn = vi.fn();
		const gateway = createTemporaryPhoneOtpGateway({ warn });

		expect(warn).toHaveBeenCalledWith(
			{ event: 'phone_otp.temporary_gateway_enabled' },
			'Temporary phone OTP gateway accepts every validated code'
		);
		expect(JSON.stringify(warn.mock.calls)).not.toContain('13800138000');

		await expect(gateway.requestCode('13800138000')).resolves.toEqual({
			expiresInSeconds: 300
		});
		await expect(gateway.verifyCode('13800138000', '000000')).resolves.toBe(true);
		await expect(gateway.verifyCode('13900139000', '654321')).resolves.toBe(true);
	});
});
