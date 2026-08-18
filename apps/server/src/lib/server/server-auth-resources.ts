import { type EmployeeIdentityDirectory, type PhoneOtpGateway } from '@hotel-butler/api';
import type {
	EmployeeHotelAccessDirectory,
	EmployeeQueryExecutor
} from './employee-identity-directory';
import {
	createEmployeeHotelAccessDirectory,
	createEmployeeIdentityDirectory
} from './employee-identity-directory';
import { createRmsClient as createDefaultRmsClient } from './db/rms';
import { safeErrorType } from './logging/logger';
import { createTemporaryPhoneOtpGateway } from './temporary-phone-otp-gateway';

type PhoneOtpLogger = Readonly<{
	info(fields: Readonly<Record<string, unknown>>, message: string): void;
	warn(fields: Readonly<Record<string, unknown>>, message: string): void;
	error(fields: Readonly<Record<string, unknown>>, message: string): void;
}>;

type RmsClient = EmployeeQueryExecutor & Readonly<{ end(): Promise<void> }>;

type ServerAuthResourcesOptions = Readonly<{
	environment: Readonly<Record<string, string | undefined>>;
	logger: PhoneOtpLogger;
	reportFailure?: boolean;
	createRmsClient?: (databaseUrl: string) => RmsClient;
	createPhoneOtp?: (logger: PhoneOtpLogger) => PhoneOtpGateway;
	now?: () => number;
}>;

export type ServerAuthResources = Readonly<{
	phoneIdentitySourceConfigured: boolean;
	employeeDirectory: EmployeeIdentityDirectory;
	employeeHotelAccessDirectory: EmployeeHotelAccessDirectory;
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

function unavailableEmployeeHotelAccessDirectory(): EmployeeHotelAccessDirectory {
	return {
		findByEmployeeId: async () => {
			throw new Error('RMS employee hotel access source is not configured');
		}
	};
}

function safeRmsErrorCode(error: unknown): string {
	if (typeof error !== 'object' || error === null || !('code' in error)) return 'UNKNOWN';
	const code = error.code;
	return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(code) ? code : 'UNKNOWN';
}

async function closeFailedRmsClient(client: RmsClient, logger: PhoneOtpLogger): Promise<void> {
	try {
		await client.end();
	} catch (error) {
		logger.warn(
			{
				errorCode: safeRmsErrorCode(error),
				errorType: safeErrorType(error),
				event: 'rms.pool.close_failed'
			},
			'Failed to close unverified RMS pool'
		);
	}
}

export async function createServerAuthResources(
	options: ServerAuthResourcesOptions
): Promise<ServerAuthResources> {
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
			employeeHotelAccessDirectory: unavailableEmployeeHotelAccessDirectory(),
			phoneOtp
		};
	}

	const now = options.now ?? (() => performance.now());
	const startedAt = now();
	let rmsClient: RmsClient | undefined;
	try {
		rmsClient = (options.createRmsClient ?? createDefaultRmsClient)(databaseUrl);
		await rmsClient.execute('SELECT 1', []);
	} catch (error) {
		if (rmsClient) await closeFailedRmsClient(rmsClient, options.logger);
		if (options.reportFailure !== false) {
			options.logger.error(
				{
					durationMs: Math.max(0, Math.round(now() - startedAt)),
					errorCode: safeRmsErrorCode(error),
					errorType: safeErrorType(error),
					event: 'rms.connection.failed'
				},
				'RMS connection verification failed'
			);
			options.logger.info(
				{
					event: 'server.auth.resources_configured',
					phoneIdentitySourceConfigured: false,
					rmsDatabaseUrlConfigured: true,
					rmsPoolEnabled: false
				},
				'Server authentication resources configured'
			);
		}
		return {
			phoneIdentitySourceConfigured: false,
			employeeDirectory: unavailableEmployeeDirectory(),
			employeeHotelAccessDirectory: unavailableEmployeeHotelAccessDirectory(),
			phoneOtp
		};
	}

	options.logger.info(
		{
			durationMs: Math.max(0, Math.round(now() - startedAt)),
			event: 'rms.connection.verified'
		},
		'RMS connection verified'
	);
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
		employeeHotelAccessDirectory: createEmployeeHotelAccessDirectory(rmsClient),
		phoneOtp
	};
}
