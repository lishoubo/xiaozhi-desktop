import type { PhoneOtpGateway } from '@hotel-butler/api';

const TEMPORARY_CODE_LIFETIME_SECONDS = 5 * 60;

type TemporaryPhoneOtpLogger = Readonly<{
	warn: (fields: Readonly<{ event: string }>, message: string) => void;
}>;

/**
 * Temporary provider boundary used only until an SMS provider is selected.
 * Input format is enforced by the shared tRPC contract; this adapter deliberately
 * performs no delivery and accepts every validated code.
 */
export function createTemporaryPhoneOtpGateway(logger: TemporaryPhoneOtpLogger): PhoneOtpGateway {
	logger.warn(
		{ event: 'phone_otp.temporary_gateway_enabled' },
		'Temporary phone OTP gateway accepts every validated code'
	);
	return {
		requestCode: async () => ({ expiresInSeconds: TEMPORARY_CODE_LIFETIME_SECONDS }),
		verifyCode: async () => true
	};
}
