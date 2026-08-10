import { describe, expect, it, vi } from 'vitest';
import { resolveStaffAgentPrincipal } from './staff-agent-principal';

describe('resolveStaffAgentPrincipal', () => {
	it('derives the principal from the RMS bearer session', async () => {
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

		await expect(resolveStaffAgentPrincipal('Bearer staff-session-a', {}, fetch)).resolves.toEqual({
			employeeId: '1001',
			orgId: '42'
		});
		expect(fetch).toHaveBeenCalledWith(
			'http://localhost:8080/api/v1/me',
			expect.objectContaining({
				headers: expect.objectContaining({ authorization: 'Bearer staff-session-a' })
			})
		);
	});

	it('does not create a principal for a rejected bearer session', async () => {
		const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
		await expect(
			resolveStaffAgentPrincipal('Bearer expired-user-session', {}, fetch)
		).resolves.toBeNull();
	});
});
