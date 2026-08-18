import { describe, expect, it, vi } from 'vitest';
import {
	createEmployeeHotelAccessDirectory,
	createEmployeeIdentityDirectory
} from './employee-identity-directory';

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

	it('restores an active employee by parameterized RMS identifier', async () => {
		const execute = vi.fn().mockResolvedValue([
			[
				{
					id: '9007199254740993',
					org_id: '42',
					username: 'front-desk-1',
					full_name: '测试员工',
					phone: '13800138000',
					role_code: 'FRONT_DESK'
				}
			],
			[]
		]);
		const directory = createEmployeeIdentityDirectory({ execute });

		await expect(directory.findActiveById('9007199254740993')).resolves.toEqual({
			id: '9007199254740993',
			orgId: '42',
			username: 'front-desk-1',
			fullName: '测试员工',
			phone: '13800138000',
			roleCode: 'FRONT_DESK'
		});
		const [sql, values] = execute.mock.calls[0] ?? [];
		expect(sql.replace(/\s+/g, ' ')).toContain('WHERE id = ? AND status = 1');
		expect(values).toEqual(['9007199254740993']);
	});

	it('loads the same managed-hotel context for a phone-authenticated employee', async () => {
		const execute = vi.fn().mockResolvedValue([
			[
				{ id: '9', name: '银际酒店' },
				{ id: '10', name: '青山酒店' }
			],
			[]
		]);
		const directory = createEmployeeHotelAccessDirectory({ execute });

		await expect(directory.findByEmployeeId('1001', '42')).resolves.toEqual({
			kind: 'staff_managed_hotels',
			currentHotelId: null,
			hotels: [
				{ id: '9', label: '银际酒店' },
				{ id: '10', label: '青山酒店' }
			]
		});
		const [sql, values] = execute.mock.calls[0] ?? [];
		expect(sql.replace(/\s+/g, ' ')).toContain(
			'WHERE hua.employee_id = ? AND hua.org_id = ? AND h.status = 1'
		);
		expect(values).toEqual(['1001', '42']);
	});
});
