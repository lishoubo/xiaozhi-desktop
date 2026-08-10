import { staffIdentitySchema, type AgentPrincipal } from '@hotel-butler/api';

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

export async function resolveStaffAgentPrincipal(
	authorization: string,
	environment: NodeJS.ProcessEnv,
	fetchImplementation: typeof globalThis.fetch = globalThis.fetch
): Promise<AgentPrincipal | null> {
	if (!authorization.startsWith('Bearer ') || authorization.length <= 7) return null;
	const response = await fetchImplementation(`${rmsOrigin(environment)}/api/v1/me`, {
		headers: {
			accept: 'application/json',
			authorization,
			'user-agent': 'XiaozhiHotelButlerServer/1.0.0'
		}
	});
	if (response.status === 401 || response.status === 403) return null;
	if (!response.ok) throw new Error(`RMS identity endpoint returned ${response.status}`);
	const envelope: unknown = await response.json();
	if (!isEnvelope(envelope) || envelope.code !== 0) return null;
	const identity = staffIdentitySchema.safeParse(envelope.data);
	if (!identity.success) throw new Error('RMS identity response did not match the shared contract');
	return { employeeId: String(identity.data.userId), orgId: String(identity.data.orgId) };
}
