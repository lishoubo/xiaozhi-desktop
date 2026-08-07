import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createDesktopSessionGateway, DESKTOP_SESSION_COOKIE_NAME } from './desktop-session';

const employee = {
	id: '42',
	orgId: '7',
	username: 'desktop-demo',
	fullName: '桌面体验员工',
	phone: '13800138000',
	roleCode: 'FRONT_DESK'
} as const;

function tokenDigest(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

function setup(
	options: {
		cookie?: string;
		now?: Date;
		record?: { employeeId: string; expiresAt: Date; tokenDigest: string } | null;
		employeeResult?: typeof employee | null;
	} = {}
) {
	const created = vi.fn().mockResolvedValue(undefined);
	const deleted = vi.fn().mockResolvedValue(undefined);
	const findByTokenDigest = vi.fn().mockResolvedValue(options.record ?? null);
	const findActiveById = vi
		.fn()
		.mockResolvedValue(options.employeeResult === undefined ? employee : options.employeeResult);
	const responseHeaders = new Headers();
	const gateway = createDesktopSessionGateway({
		employeeDirectory: {
			findActiveById,
			findActiveByPhone: vi.fn().mockResolvedValue(employee)
		},
		generateId: () => 'session-id',
		generateToken: () => 'a'.repeat(43),
		now: () => options.now ?? new Date('2026-08-07T00:00:00.000Z'),
		repository: { create: created, deleteByTokenDigest: deleted, findByTokenDigest },
		requestHeaders: new Headers(options.cookie ? { cookie: options.cookie } : undefined),
		responseHeaders
	});
	return { created, deleted, findActiveById, findByTokenDigest, gateway, responseHeaders };
}

describe('desktop HTTP session gateway', () => {
	it('stores only a token digest and emits a seven-day hardened host cookie', async () => {
		const { created, gateway, responseHeaders } = setup();

		await gateway.issue(employee);

		expect(created).toHaveBeenCalledWith({
			id: 'session-id',
			employeeId: '42',
			tokenDigest: tokenDigest('a'.repeat(43)),
			createdAt: new Date('2026-08-07T00:00:00.000Z'),
			expiresAt: new Date('2026-08-14T00:00:00.000Z')
		});
		const cookie = responseHeaders.get('set-cookie');
		expect(cookie).toContain(`${DESKTOP_SESSION_COOKIE_NAME}=${'a'.repeat(43)}`);
		expect(cookie).toContain('Path=/');
		expect(cookie).toContain('HttpOnly');
		expect(cookie).toContain('Secure');
		expect(cookie).toContain('SameSite=Strict');
		expect(cookie).toContain('Max-Age=604800');
		expect(cookie).not.toContain('Domain=');
		expect(JSON.stringify(created.mock.calls)).not.toContain('a'.repeat(43));
	});

	it('restores the current active RMS employee from an unexpired token', async () => {
		const token = 'b'.repeat(43);
		const { findActiveById, gateway } = setup({
			cookie: `${DESKTOP_SESSION_COOKIE_NAME}=${token}`,
			record: {
				employeeId: '42',
				expiresAt: new Date('2026-08-08T00:00:00.000Z'),
				tokenDigest: tokenDigest(token)
			}
		});

		await expect(gateway.currentEmployee()).resolves.toEqual(employee);
		expect(findActiveById).toHaveBeenCalledWith('42');
	});

	it.each([
		['missing', undefined],
		['malformed', `${DESKTOP_SESSION_COOKIE_NAME}=not-a-token`]
	])('does not query persistence for a %s cookie', async (_label, cookie) => {
		const { findByTokenDigest, gateway, responseHeaders } = setup({ cookie });

		await expect(gateway.currentEmployee()).resolves.toBeNull();
		expect(findByTokenDigest).not.toHaveBeenCalled();
		if (_label === 'malformed') {
			expect(responseHeaders.get('set-cookie')).toContain('Max-Age=0');
		}
	});

	it('revokes and clears expired sessions', async () => {
		const token = 'c'.repeat(43);
		const { deleted, gateway, responseHeaders } = setup({
			cookie: `${DESKTOP_SESSION_COOKIE_NAME}=${token}`,
			record: {
				employeeId: '42',
				expiresAt: new Date('2026-08-06T00:00:00.000Z'),
				tokenDigest: tokenDigest(token)
			}
		});

		await expect(gateway.currentEmployee()).resolves.toBeNull();
		expect(deleted).toHaveBeenCalledWith(tokenDigest(token));
		expect(responseHeaders.get('set-cookie')).toContain('Max-Age=0');
	});

	it('revokes a session when its RMS employee is no longer active', async () => {
		const token = 'd'.repeat(43);
		const { deleted, gateway } = setup({
			cookie: `${DESKTOP_SESSION_COOKIE_NAME}=${token}`,
			employeeResult: null,
			record: {
				employeeId: '42',
				expiresAt: new Date('2026-08-08T00:00:00.000Z'),
				tokenDigest: tokenDigest(token)
			}
		});

		await expect(gateway.currentEmployee()).resolves.toBeNull();
		expect(deleted).toHaveBeenCalledWith(tokenDigest(token));
	});

	it('deletes the presented session and clears its cookie on logout', async () => {
		const token = 'e'.repeat(43);
		const { deleted, gateway, responseHeaders } = setup({
			cookie: `${DESKTOP_SESSION_COOKIE_NAME}=${token}`
		});

		await gateway.revoke();

		expect(deleted).toHaveBeenCalledWith(tokenDigest(token));
		expect(responseHeaders.get('set-cookie')).toContain('Max-Age=0');
	});
});
