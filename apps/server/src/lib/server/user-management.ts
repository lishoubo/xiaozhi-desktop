import { asc, count, desc, ilike, or } from 'drizzle-orm';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/auth.schema';

export const managedUserPageSize = 20;

export interface ManagedUserQuery {
	page: number;
	search: string;
}

export function parseManagedUserQuery(searchParams: URLSearchParams): ManagedUserQuery {
	const requestedPage = Number.parseInt(searchParams.get('page') ?? '1', 10);
	return {
		page: Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
		search: (searchParams.get('q') ?? '').trim().slice(0, 100)
	};
}

function escapeLikePattern(value: string): string {
	return value.replace(/[\\%_]/g, '\\$&');
}

export async function listManagedUsers(query: ManagedUserQuery) {
	const searchPattern = `%${escapeLikePattern(query.search)}%`;
	const where = query.search
		? or(
				ilike(user.username, searchPattern),
				ilike(user.phoneNumber, searchPattern),
				ilike(user.name, searchPattern)
			)
		: undefined;
	const offset = (query.page - 1) * managedUserPageSize;
	const [users, totalRows] = await Promise.all([
		db
			.select({
				banned: user.banned,
				createdAt: user.createdAt,
				id: user.id,
				name: user.name,
				phoneNumber: user.phoneNumber,
				phoneNumberVerified: user.phoneNumberVerified,
				role: user.role,
				username: user.username
			})
			.from(user)
			.where(where)
			.orderBy(desc(user.createdAt), asc(user.id))
			.limit(managedUserPageSize)
			.offset(offset),
		db.select({ count: count() }).from(user).where(where)
	]);

	return {
		page: query.page,
		pageCount: Math.max(1, Math.ceil((totalRows[0]?.count ?? 0) / managedUserPageSize)),
		search: query.search,
		total: totalRows[0]?.count ?? 0,
		users
	};
}

export async function setManagedUserRole(
	headers: Headers,
	userId: string,
	role: 'user' | 'superAdmin'
): Promise<void> {
	await auth.api.setRole({ body: { role, userId }, headers });
}

export async function setManagedUserBanned(
	headers: Headers,
	userId: string,
	banned: boolean
): Promise<void> {
	if (banned) {
		await auth.api.banUser({ body: { banReason: '由后台管理员停用', userId }, headers });
		return;
	}
	await auth.api.unbanUser({ body: { userId }, headers });
}
