import type { DestinationStream } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { createServerLogger } from '$lib/server/logging/logger';
import { resolveStaffAgentPrincipal } from './staff-agent-principal';

function capturedLogger(): Readonly<{
	logger: ReturnType<typeof createServerLogger>;
	records: string[];
}> {
	const records: string[] = [];
	const destination: DestinationStream = {
		write(message) {
			records.push(message);
		}
	};
	return { logger: createServerLogger({ destination, level: 'info' }), records };
}

describe('resolveStaffAgentPrincipal', () => {
	it('derives the principal from an RMS bearer session over remote HTTP', async () => {
		const { logger, records } = capturedLogger();
		const fetch = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					code: 0,
					data: {
						userId: 1001,
						username: 'front-desk',
						fullName: '前台员工',
						role: 'FRONT_DESK',
						orgId: 42,
						currentHotelId: 9,
						accessibleHotelIds: [9],
						permissions: ['ORDER_READ']
					}
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } }
			)
		);

		await expect(
			resolveStaffAgentPrincipal(
				'Bearer staff-session-a',
				{ XIAOZHI_RMS_SERVER_URL: 'http://rms.internal.example:8080' },
				fetch,
				{
					logger,
					now: vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(126),
					requestId: 'request-rms-success'
				}
			)
		).resolves.toEqual({ employeeId: '1001', orgId: '42' });
		expect(fetch).toHaveBeenCalledWith(
			'http://rms.internal.example:8080/api/v1/me',
			expect.objectContaining({
				headers: expect.objectContaining({ authorization: 'Bearer staff-session-a' })
			})
		);
		const serialized = records.join('');
		expect(serialized).toContain('rms.http.request.started');
		expect(serialized).toContain('rms.http.request.completed');
		expect(serialized).toContain('request-rms-success');
		expect(serialized).toContain('"status":200');
		expect(serialized).toContain('"durationMs":26');
		expect(serialized).toContain('"outcome":"authenticated"');
		expect(serialized).not.toContain('staff-session-a');
		expect(serialized).not.toContain('front-desk');
		expect(serialized).not.toContain('前台员工');
	});

	it('does not create a principal for a rejected bearer session', async () => {
		const { logger, records } = capturedLogger();
		const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
		await expect(
			resolveStaffAgentPrincipal('Bearer expired-user-session', {}, fetch, {
				logger,
				now: vi.fn().mockReturnValueOnce(200).mockReturnValueOnce(205),
				requestId: 'request-rms-rejected'
			})
		).resolves.toBeNull();
		const serialized = records.join('');
		expect(serialized).toContain('rms.http.request.completed');
		expect(serialized).toContain('"status":401');
		expect(serialized).toContain('"outcome":"unauthorized"');
		expect(serialized).not.toContain('expired-user-session');
	});

	it('logs a redacted failure before preserving an RMS transport error', async () => {
		const { logger, records } = capturedLogger();
		const fetch = vi.fn().mockRejectedValue(new TypeError('authorization=Bearer private-token'));

		await expect(
			resolveStaffAgentPrincipal('Bearer private-token', {}, fetch, {
				logger,
				now: vi.fn().mockReturnValueOnce(300).mockReturnValueOnce(309),
				requestId: 'request-rms-failure'
			})
		).rejects.toThrow(TypeError);
		const serialized = records.join('');
		expect(serialized).toContain('rms.http.request.failed');
		expect(serialized).toContain('request-rms-failure');
		expect(serialized).toContain('"durationMs":9');
		expect(serialized).toContain('[Redacted]');
		expect(serialized).not.toContain('private-token');
	});
});
