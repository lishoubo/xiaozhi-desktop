import { env } from '$env/dynamic/private';
import { serverLogger } from './logging/logger';
import { createServerAuthResources, type ServerAuthResources } from './server-auth-resources';

type AuthResourcesRuntimeOptions = Readonly<{
	isRmsConfigured(): boolean;
	load(): Promise<ServerAuthResources>;
	now?: () => number;
	retryDelayMs?: number;
}>;

export function createAuthResourcesRuntime(options: AuthResourcesRuntimeOptions) {
	const now = options.now ?? (() => Date.now());
	const retryDelayMs = options.retryDelayMs ?? 10_000;
	let current: ServerAuthResources | undefined;
	let inFlight: Promise<ServerAuthResources> | undefined;
	let retryAfter = 0;

	return async (): Promise<ServerAuthResources> => {
		if (current?.phoneIdentitySourceConfigured === true) return current;
		if (current && (!options.isRmsConfigured() || now() < retryAfter)) return current;
		if (inFlight) return inFlight;

		inFlight = options.load();
		try {
			current = await inFlight;
			retryAfter =
				current.phoneIdentitySourceConfigured || !options.isRmsConfigured()
					? Number.POSITIVE_INFINITY
					: now() + retryDelayMs;
			return current;
		} finally {
			inFlight = undefined;
		}
	};
}

const loadServerAuthResources = createAuthResourcesRuntime({
	isRmsConfigured: () => Boolean(env.RMS_DATABASE_URL?.trim()),
	load: () => createServerAuthResources({ environment: env, logger: serverLogger })
});

/** Start during server init, retry transient failures, and share the first verified RMS pool. */
export function initializeServerAuthResources(): Promise<ServerAuthResources> {
	return loadServerAuthResources();
}
