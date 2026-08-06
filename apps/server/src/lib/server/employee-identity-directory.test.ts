import { describe, expect, it, vi } from 'vitest';
import { createEmployeeIdentityDirectory } from './employee-identity-directory';

describe('RMS employee identity directory', () => {
	it('uses a parameterized active-employee query and maps only safe identity fields', async () => {
		const execute = vi.fn().mockResolvedValue([
			[
				{
					id: '9007199254740993',
					org_id: '42',
					username: 'front-desk-1',
					password_hash: 'must-not-leak',
					full_name: '测试员工',
					phone: '13800138000',
					role_code: 'FRONT_DESK'
				}
			],
			[]
		]);
		const directory = createEmployeeIdentityDirectory({ execute });

		const identity = await directory.findActiveByPhone('13800138000');

		expect(identity).toEqual({
			id: '9007199254740993',
			orgId: '42',
			username: 'front-desk-1',
			fullName: '测试员工',
			phone: '13800138000',
			roleCode: 'FRONT_DESK'
		});
		expect(JSON.stringify(identity)).not.toContain('password');
		const [sql, values] = execute.mock.calls[0] ?? [];
		expect(sql.replace(/\s+/g, ' ')).toContain('WHERE phone = ? AND status = 1');
		expect(sql).not.toContain('password_hash');
		expect(values).toEqual(['13800138000']);
	});

	it('returns no identity when RMS has no active employee for the phone', async () => {
		const execute = vi.fn().mockResolvedValue([[], []]);
		const directory = createEmployeeIdentityDirectory({ execute });

		await expect(directory.findActiveByPhone('13900139000')).resolves.toBeNull();
	});
});
