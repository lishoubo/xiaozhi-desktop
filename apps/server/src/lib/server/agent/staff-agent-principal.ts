import { staffIdentitySchema } from '@hotel-butler/api';
import type { AgentPrincipal } from '@hotel-butler/api/router';
import { z } from 'zod';
import { safeErrorDetails, serverLogger } from '$lib/server/logging/logger';
import type { RequestLogger } from '$lib/server/logging/request-logging';

type ApiEnvelope = Readonly<{ code: number; data: unknown }>;

const staffHotelSchema = z.object({
	id: z.number().int().positive(),
	name: z.string().trim().min(1).max(256),
	status: z.number().int()
});
type StaffHotel = Readonly<z.infer<typeof staffHotelSchema>>;
type HotelCacheEntry = Readonly<{ expiresAt: number; hotels: readonly StaffHotel[] }>;

const HOTEL_CACHE_TTL_MS = 30_000;
const RMS_IDENTITY_TIMEOUT_MS = 10_000;
const hotelCache = new Map<string, HotelCacheEntry>();
const hotelLoads = new Map<string, Promise<readonly StaffHotel[]>>();

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
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error('RMS identity endpoint must use HTTP or HTTPS');
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

async function loadAccessibleHotels(
	authorization: string,
	endpointOrigin: string,
	userId: number,
	accessibleHotelIds: readonly number[],
	fetchImplementation: typeof globalThis.fetch
): Promise<readonly StaffHotel[]> {
	if (accessibleHotelIds.length === 0) return [];
	const sortedIds = [...new Set(accessibleHotelIds)].sort((left, right) => left - right);
	const cacheKey = `${endpointOrigin}:${userId}:${sortedIds.join(',')}`;
	const cached = hotelCache.get(cacheKey);
	if (cached && cached.expiresAt > Date.now()) return cached.hotels;
	const inFlight = hotelLoads.get(cacheKey);
	if (inFlight) return inFlight;
	const load = (async () => {
		const response = await fetchImplementation(`${endpointOrigin}/api/v1/app/hotels`, {
			signal: AbortSignal.timeout(RMS_IDENTITY_TIMEOUT_MS),
			headers: {
				accept: 'application/json',
				authorization,
				'user-agent': 'XiaozhiHotelButlerServer/1.0.0'
			}
		});
		if (!response.ok) throw new Error(`RMS hotel endpoint returned ${response.status}`);
		const envelope: unknown = await response.json();
		if (!isEnvelope(envelope) || envelope.code !== 0) {
			throw new Error('RMS hotel response did not match the API envelope');
		}
		const hotels = z.array(staffHotelSchema).parse(envelope.data);
		const allowed = new Set(sortedIds);
		const accessible = hotels.filter((hotel) => allowed.has(hotel.id));
		if (hotelCache.size >= 500) hotelCache.clear();
		hotelCache.set(cacheKey, { expiresAt: Date.now() + HOTEL_CACHE_TTL_MS, hotels: accessible });
		return accessible;
	})();
	hotelLoads.set(cacheKey, load);
	try {
		return await load;
	} finally {
		hotelLoads.delete(cacheKey);
	}
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
			signal: AbortSignal.timeout(RMS_IDENTITY_TIMEOUT_MS),
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

		const hotels = await loadAccessibleHotels(
			authorization,
			endpointOrigin,
			identity.data.userId,
			identity.data.accessibleHotelIds,
			fetchImplementation
		);

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
		return {
			employeeId: String(identity.data.userId),
			orgId: String(identity.data.orgId),
			hotelAccess: {
				kind: 'staff_managed_hotels',
				currentHotelId:
					identity.data.currentHotelId == null ? null : String(identity.data.currentHotelId),
				hotels: hotels.map((hotel) => ({ id: String(hotel.id), label: hotel.name }))
			}
		};
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
