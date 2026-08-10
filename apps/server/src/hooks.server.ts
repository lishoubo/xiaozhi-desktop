import type { Handle, HandleServerError, ServerInit } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { building } from '$app/environment';
import { auth } from '$lib/server/auth';
import { isDesktopTrpcPath } from '$lib/server/desktop-trpc-path';
import { safeErrorDetails, safeErrorType, serverLogger } from '$lib/server/logging/logger';
import { executeLoggedRequest } from '$lib/server/logging/request-logging';
import { svelteKitHandler } from 'better-auth/svelte-kit';

export const init: ServerInit = () => {
	serverLogger.info(
		{ event: 'server.logging.initialized', logLevel: serverLogger.level },
		'Server logging initialized'
	);
};

const handleRequestLogging: Handle = ({ event, resolve }) =>
	executeLoggedRequest({
		incomingRequestId: event.request.headers.get('x-request-id'),
		logger: serverLogger,
		method: event.request.method,
		resolve: ({ requestId, requestLogger }) => {
			event.locals.requestId = requestId;
			event.locals.logger = requestLogger;
			return resolve(event);
		},
		routeId: event.route.id,
		setResponseHeader: (name, value) => event.setHeaders({ [name]: value })
	});

const handleBetterAuth: Handle = async ({ event, resolve }) => {
	if (isDesktopTrpcPath(event.url.pathname)) return resolve(event);

	const session = await auth.api.getSession({ headers: event.request.headers });

	if (session) {
		event.locals.session = session.session;
		event.locals.user = session.user;
	}

	return svelteKitHandler({ event, resolve, auth, building });
};

export const handle: Handle = sequence(handleRequestLogging, handleBetterAuth);

export const handleError: HandleServerError = ({ error, event, status }) => {
	const requestId = event.locals.requestId ?? 'unavailable';
	const logger = event.locals.logger ?? serverLogger.child({ requestId });
	logger.error(
		{
			error: safeErrorDetails(error),
			errorType: safeErrorType(error),
			event: 'sveltekit.request.failed',
			method: event.request.method,
			routeId: event.route.id ?? 'unmatched',
			statusCode: status
		},
		'SvelteKit request failed'
	);

	return {
		message: 'An unexpected server error occurred',
		requestId
	};
};
