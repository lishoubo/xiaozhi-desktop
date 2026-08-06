import type { EmployeeIdentity, EmployeeIdentityDirectory } from '@hotel-butler/api';
import type { ExecuteValues } from 'mysql2';

export interface EmployeeQueryExecutor {
	execute(sql: string, values: ExecuteValues): Promise<readonly [unknown, unknown]>;
}

type EmployeeRow = {
	id: string;
	org_id: string;
	username: string;
	full_name: string | null;
	phone: string;
	role_code: string;
};

function isIdentifier(value: unknown): value is string {
	return typeof value === 'string' && /^\d+$/.test(value);
}

function isEmployeeRow(value: unknown): value is EmployeeRow {
	return (
		typeof value === 'object' &&
		value !== null &&
		'id' in value &&
		isIdentifier(value.id) &&
		'org_id' in value &&
		isIdentifier(value.org_id) &&
		'username' in value &&
		typeof value.username === 'string' &&
		'full_name' in value &&
		(value.full_name === null || typeof value.full_name === 'string') &&
		'phone' in value &&
		typeof value.phone === 'string' &&
		'role_code' in value &&
		typeof value.role_code === 'string'
	);
}

function mapEmployeeRow(row: EmployeeRow): EmployeeIdentity {
	return {
		id: row.id,
		orgId: row.org_id,
		username: row.username,
		fullName: row.full_name,
		phone: row.phone,
		roleCode: row.role_code
	};
}

export function createEmployeeIdentityDirectory(
	executor: EmployeeQueryExecutor
): EmployeeIdentityDirectory {
	return {
		findActiveByPhone: async (phone) => {
			const [rows] = await executor.execute(
				`SELECT id, org_id, username, full_name, phone, role_code
				 FROM employee
				 WHERE phone = ? AND status = 1
				 ORDER BY id ASC
				 LIMIT 1`,
				[phone]
			);
			if (!Array.isArray(rows) || rows.length === 0) return null;
			const row = rows[0];
			if (!isEmployeeRow(row)) throw new Error('RMS employee query returned an invalid row');
			return mapEmployeeRow(row);
		}
	};
}
