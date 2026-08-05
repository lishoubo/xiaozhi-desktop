import { randomUUID } from 'node:crypto';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

export interface RequestLogger {
	debug(fields: Record<string, unknown>, message: string): void;
	info(fields: Record<string, unknown>, message: string): void;
	warn(fields: Record<string, unknown>, message: string): void;
	error(fields: Record<string, unknown>, message: string): void;
}

interface RootLogger {
	child(bindings: { requestId: string }): RequestLogger;
}

interface LoggedRequestContext {
	requestId: string;
	requestLogger: RequestLogger;
}

interface ExecuteLoggedRequestOptions {
	incomingRequestId: string | null;
	logger: RootLogger;
	method: string;
	now?: () => number;
	requestIdFactory?: () => string;
	resolve(context: LoggedRequestContext): Response | Promise<Response>;
	routeId: string | null;
	setResponseHeader(name: string, value: string): void;
}

export function resolveRequestId(
	incomingRequestId: string | null,
	requestIdFactory: () => string = randomUUID
): string {
	return incomingRequestId && SAFE_REQUEST_ID.test(incomingRequestId)
		? incomingRequestId
		: requestIdFactory();
}

export async function executeLoggedRequest({
	incomingRequestId,
	logger,
	method,
	now = () => performance.now(),
	requestIdFactory,
	resolve,
	routeId,
	setResponseHeader
}: ExecuteLoggedRequestOptions): Promise<Response> {
	const requestId = resolveRequestId(incomingRequestId, requestIdFactory);
	const requestLogger = logger.child({ requestId });
	const startedAt = now();
	setResponseHeader('x-request-id', requestId);

	const response = await resolve({ requestId, requestLogger });
	const fields = {
		durationMs: Math.max(0, Math.round(now() - startedAt)),
		event: 'http.request.completed',
		method,
		routeId: routeId ?? 'unmatched',
		statusCode: response.status
	};

	if (response.status >= 500) requestLogger.error(fields, 'HTTP request completed');
	else if (response.status >= 400) requestLogger.warn(fields, 'HTTP request completed');
	else requestLogger.debug(fields, 'HTTP request completed');

	return response;
}
