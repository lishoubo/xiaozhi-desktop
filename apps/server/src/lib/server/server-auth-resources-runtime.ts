import { env } from '$env/dynamic/private';
import type { PhoneOtpGateway } from './desktop-api-endpoint';
import { safeErrorType, serverLogger } from './logging/logger';
import { createServerAuthResources, type ServerAuthResources } from './server-auth-resources';
import { createTemporaryPhoneOtpGateway } from './temporary-phone-otp-gateway';

type AuthResourcesRuntimeOptions = Readonly<{
	isRmsConfigured(): boolean;
	load(options: Readonly<{ reportFailure: boolean }>): Promise<ServerAuthResources>;
	reportUnexpectedFailure?(error: unknown): void;
	now?: () => number;
	retryDelayMs?: number;
}>;

export function createAuthResourcesRuntime(options: AuthResourcesRuntimeOptions) {
	const now = options.now ?? (() => Date.now());
	const retryDelayMs = options.retryDelayMs ?? 10_000;
	let current: ServerAuthResources | undefined;
	let inFlight: Promise<ServerAuthResources> | undefined;
	let retryAfter = 0;
	const recordResult = (resources: ServerAuthResources): ServerAuthResources => {
		current = resources;
		retryAfter =
			resources.phoneIdentitySourceConfigured || !options.isRmsConfigured()
				? Number.POSITIVE_INFINITY
				: now() + retryDelayMs;
		return resources;
	};

	return async (
		request: Readonly<{ waitForRetry?: boolean }> = {}
	): Promise<ServerAuthResources> => {
		if (current?.phoneIdentitySourceConfigured === true) return current;
		if (current && (!options.isRmsConfigured() || now() < retryAfter)) return current;
		if (current) {
			const fallback = current;
			if (!inFlight) {
				inFlight = options
					.load({ reportFailure: false })
					.then(recordResult)
					.catch((error: unknown) => {
						options.reportUnexpectedFailure?.(error);
						return fallback;
					})
					.finally(() => {
						inFlight = undefined;
					});
			}
			return request.waitForRetry ? inFlight : current;
		}
		if (!inFlight) inFlight = options.load({ reportFailure: true }).then(recordResult);
		try {
			return await inFlight;
		} finally {
			inFlight = undefined;
		}
	};
}

let sharedPhoneOtp: PhoneOtpGateway | undefined;
const loadServerAuthResources = createAuthResourcesRuntime({
	isRmsConfigured: () => Boolean(env.RMS_DATABASE_URL?.trim()),
	reportUnexpectedFailure: (error) =>
		serverLogger.error(
			{ errorType: safeErrorType(error), event: 'server.auth.resources_retry_failed' },
			'Unexpected authentication resource retry failure'
		),
	load: ({ reportFailure }) =>
		createServerAuthResources({
			environment: env,
			logger: serverLogger,
			reportFailure,
			createPhoneOtp: (logger) =>
				(sharedPhoneOtp ??= createTemporaryPhoneOtpGateway(logger))
		})
});

/** Start during server init, retry transient failures, and share the first verified RMS pool. */
export function initializeServerAuthResources(
	options: Readonly<{ waitForRetry?: boolean }> = {}
): Promise<ServerAuthResources> {
	return loadServerAuthResources(options);
}
