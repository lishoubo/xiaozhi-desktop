import { describe, expect, it } from 'vitest';
import { isDesktopTrpcPath } from './desktop-trpc-path';

describe('isDesktopTrpcPath', () => {
	it('recognizes desktop tRPC endpoints', () => {
		expect(isDesktopTrpcPath('/api/trpc')).toBe(true);
		expect(isDesktopTrpcPath('/api/trpc/auth.requestPhoneCode')).toBe(true);
	});

	it('does not bypass administrator authentication routes', () => {
		expect(isDesktopTrpcPath('/api/auth/get-session')).toBe(false);
		expect(isDesktopTrpcPath('/admin')).toBe(false);
		expect(isDesktopTrpcPath('/api/trpc-admin')).toBe(false);
	});
});
