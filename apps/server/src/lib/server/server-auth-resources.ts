import { type EmployeeIdentityDirectory, type PhoneOtpGateway } from '@hotel-butler/api';
import type { EmployeeQueryExecutor } from './employee-identity-directory';
import { createEmployeeIdentityDirectory } from './employee-identity-directory';
import { createRmsClient as createDefaultRmsClient } from './db/rms';
import { createTemporaryPhoneOtpGateway } from './temporary-phone-otp-gateway';

type PhoneOtpLogger = Readonly<{
	info(fields: Readonly<Record<string, unknown>>, message: string): void;
	warn(fields: Readonly<{ event: string }>, message: string): void;
}>;

type ServerAuthResourcesOptions = Readonly<{
	environment: Readonly<Record<string, string | undefined>>;
	logger: PhoneOtpLogger;
	createRmsClient?: (databaseUrl: string) => EmployeeQueryExecutor;
	createPhoneOtp?: (logger: PhoneOtpLogger) => PhoneOtpGateway;
}>;

export type ServerAuthResources = Readonly<{
	phoneIdentitySourceConfigured: boolean;
	employeeDirectory: EmployeeIdentityDirectory;
	phoneOtp: PhoneOtpGateway;
}>;

function unavailableEmployeeDirectory(): EmployeeIdentityDirectory {
	const unavailable = async (): Promise<never> => {
		throw new Error('RMS employee identity source is not configured');
	};
	return {
		findActiveById: unavailable,
		findActiveByPhone: unavailable
	};
}

export function createServerAuthResources(
	options: ServerAuthResourcesOptions
): ServerAuthResources {
	const phoneOtp = (options.createPhoneOtp ?? createTemporaryPhoneOtpGateway)(options.logger);
	const databaseUrl = options.environment.RMS_DATABASE_URL?.trim();
	if (!databaseUrl) {
		options.logger.info(
			{
				event: 'server.auth.resources_configured',
				phoneIdentitySourceConfigured: false,
				rmsPoolEnabled: false
			},
			'Server authentication resources configured'
		);
		return {
			phoneIdentitySourceConfigured: false,
			employeeDirectory: unavailableEmployeeDirectory(),
			phoneOtp
		};
	}

	const rmsClient = (options.createRmsClient ?? createDefaultRmsClient)(databaseUrl);
	options.logger.info(
		{
			event: 'server.auth.resources_configured',
			phoneIdentitySourceConfigured: true,
			rmsPoolEnabled: true
		},
		'Server authentication resources configured'
	);
	return {
		phoneIdentitySourceConfigured: true,
		employeeDirectory: createEmployeeIdentityDirectory(rmsClient),
		phoneOtp
	};
}
