import type {
	AgentHotelAccess,
	EmployeeIdentity,
	EmployeeIdentityDirectory
} from '@hotel-butler/api';
import type { ExecuteValues } from 'mysql2';

export interface EmployeeQueryExecutor {
	execute(sql: string, values: ExecuteValues): Promise<readonly [unknown, unknown]>;
}

export interface EmployeeHotelAccessDirectory {
	findByEmployeeId(employeeId: string, orgId: string): Promise<AgentHotelAccess>;
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
	const findActive = async (
		field: 'id' | 'phone',
		value: string
	): Promise<EmployeeIdentity | null> => {
		const [rows] = await executor.execute(
			`SELECT id, org_id, username, full_name, phone, role_code
			 FROM employee
			 WHERE ${field} = ? AND status = 1
			 ORDER BY id ASC
			 LIMIT 1`,
			[value]
		);
		if (!Array.isArray(rows) || rows.length === 0) return null;
		const row = rows[0];
		if (!isEmployeeRow(row)) throw new Error('RMS employee query returned an invalid row');
		return mapEmployeeRow(row);
	};

	return {
		findActiveById: (id) => findActive('id', id),
		findActiveByPhone: (phone) => findActive('phone', phone)
	};
}

export function createEmployeeHotelAccessDirectory(
	executor: EmployeeQueryExecutor
): EmployeeHotelAccessDirectory {
	return {
		findByEmployeeId: async (employeeId, orgId) => {
			const [rows] = await executor.execute(
				`SELECT h.id, h.name
				 FROM hotel_user_access AS hua
				 INNER JOIN hotel AS h
				   ON h.id = hua.hotel_id AND h.org_id = hua.org_id
				 WHERE hua.employee_id = ? AND hua.org_id = ? AND h.status = 1
				 ORDER BY h.name ASC, h.id ASC`,
				[employeeId, orgId]
			);
			if (!Array.isArray(rows)) throw new Error('RMS hotel access query returned invalid rows');
			const hotels = rows.map((row) => {
				if (
					typeof row !== 'object' ||
					row === null ||
					!('id' in row) ||
					!isIdentifier(String(row.id)) ||
					!('name' in row) ||
					typeof row.name !== 'string' ||
					!row.name.trim()
				) {
					throw new Error('RMS hotel access query returned an invalid row');
				}
				return { id: String(row.id), label: row.name.trim() };
			});
			return { kind: 'staff_managed_hotels', currentHotelId: null, hotels };
		}
	};
}
