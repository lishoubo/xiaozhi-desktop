import { staffIdentitySchema, type AgentPrincipal } from '@hotel-butler/api';
import { safeErrorDetails, serverLogger } from '$lib/server/logging/logger';
import type { RequestLogger } from '$lib/server/logging/request-logging';

type ApiEnvelope = Readonly<{ code: number; data: unknown }>;

function isEnvelope(value: unknown): value is ApiEnvelope {
	return (
		typeof value === 'object' &&
		value !== null &&
		'code' in value &&
		typeof value.code === 'number' &&
		'data' in value
	);
}

function rmsOrigin(environment: NodeJS.ProcessEnv): string {
	const url = new URL(environment.XIAOZHI_RMS_SERVER_URL ?? 'http://localhost:8080');
	const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
		throw new Error('Remote RMS identity endpoint must use HTTPS');
	}
	return url.origin;
}

type RmsRequestLoggingOptions = Readonly<{
	logger?: RequestLogger;
	now?: () => number;
	requestId?: string;
}>;

function elapsedMilliseconds(startedAt: number, now: () => number): number {
	return Math.max(0, Math.round(now() - startedAt));
}

export async function resolveStaffAgentPrincipal(
	authorization: string,
	environment: NodeJS.ProcessEnv,
	fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
	logging: RmsRequestLoggingOptions = {}
): Promise<AgentPrincipal | null> {
	if (!authorization.startsWith('Bearer ') || authorization.length <= 7) return null;

	const now = logging.now ?? (() => performance.now());
	const startedAt = now();
	const endpointOrigin = rmsOrigin(environment);
	const endpointPath = '/api/v1/me';
	const logger = logging.logger ?? serverLogger;
	const logContext = {
		externalService: 'rms',
		operation: 'resolve_staff_identity',
		...(logging.requestId ? { requestId: logging.requestId } : {})
	};
	let responseStatus: number | undefined;

	logger.info(
		{
			...logContext,
			event: 'rms.http.request.started',
			endpointOrigin,
			endpointPath,
			method: 'GET'
		},
		'RMS HTTP request started'
	);

	try {
		const response = await fetchImplementation(`${endpointOrigin}${endpointPath}`, {
			headers: {
				accept: 'application/json',
				authorization,
				'user-agent': 'XiaozhiHotelButlerServer/1.0.0'
			}
		});
		responseStatus = response.status;
		if (response.status === 401 || response.status === 403) {
			logger.info(
				{
					...logContext,
					durationMs: elapsedMilliseconds(startedAt, now),
					event: 'rms.http.request.completed',
					outcome: 'unauthorized',
					status: response.status
				},
				'RMS HTTP request completed'
			);
			return null;
		}
		if (!response.ok) throw new Error(`RMS identity endpoint returned ${response.status}`);

		const envelope: unknown = await response.json();
		if (!isEnvelope(envelope) || envelope.code !== 0) {
			logger.info(
				{
					...logContext,
					durationMs: elapsedMilliseconds(startedAt, now),
					event: 'rms.http.request.completed',
					outcome: 'identity_rejected',
					status: response.status
				},
				'RMS HTTP request completed'
			);
			return null;
		}
		const identity = staffIdentitySchema.safeParse(envelope.data);
		if (!identity.success) {
			throw new Error('RMS identity response did not match the shared contract');
		}

		logger.info(
			{
				...logContext,
				durationMs: elapsedMilliseconds(startedAt, now),
				event: 'rms.http.request.completed',
				outcome: 'authenticated',
				status: response.status
			},
			'RMS HTTP request completed'
		);
		return { employeeId: String(identity.data.userId), orgId: String(identity.data.orgId) };
	} catch (error) {
		logger.error(
			{
				...logContext,
				durationMs: elapsedMilliseconds(startedAt, now),
				error: safeErrorDetails(error),
				event: 'rms.http.request.failed',
				...(responseStatus === undefined ? {} : { status: responseStatus })
			},
			'RMS HTTP request failed'
		);
		throw error;
	}
}
