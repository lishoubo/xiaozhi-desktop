import { and, asc, count, desc, eq, ilike, or } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	desktopUser,
	desktopUserStatuses,
	type DesktopUserStatus
} from '$lib/server/db/desktop-user.schema';

export const desktopUserPageSize = 20;

export interface DesktopUserQuery {
	page: number;
	search: string;
	status: DesktopUserStatus | 'all';
}

export function parseDesktopUserQuery(searchParams: URLSearchParams): DesktopUserQuery {
	const requestedPage = Number.parseInt(searchParams.get('page') ?? '1', 10);
	const requestedStatus = searchParams.get('status');
	return {
		page: Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
		search: (searchParams.get('q') ?? '').trim().slice(0, 100),
		status: desktopUserStatuses.includes(requestedStatus as DesktopUserStatus)
			? (requestedStatus as DesktopUserStatus)
			: 'all'
	};
}

function escapeLikePattern(value: string): string {
	return value.replace(/[\\%_]/g, '\\$&');
}

export async function listDesktopUsers(query: DesktopUserQuery) {
	const searchPattern = `%${escapeLikePattern(query.search)}%`;
	const searchCondition = query.search
		? or(
				ilike(desktopUser.phoneNumber, searchPattern),
				ilike(desktopUser.displayName, searchPattern)
			)
		: undefined;
	const statusCondition = query.status === 'all' ? undefined : eq(desktopUser.status, query.status);
	const where = and(searchCondition, statusCondition);
	const offset = (query.page - 1) * desktopUserPageSize;
	const [users, totalRows] = await Promise.all([
		db
			.select({
				createdAt: desktopUser.createdAt,
				displayName: desktopUser.displayName,
				id: desktopUser.id,
				lastLoginAt: desktopUser.lastLoginAt,
				phoneNumber: desktopUser.phoneNumber,
				phoneNumberVerified: desktopUser.phoneNumberVerified,
				status: desktopUser.status
			})
			.from(desktopUser)
			.where(where)
			.orderBy(desc(desktopUser.createdAt), asc(desktopUser.id))
			.limit(desktopUserPageSize)
			.offset(offset),
		db.select({ count: count() }).from(desktopUser).where(where)
	]);

	return {
		page: query.page,
		pageCount: Math.max(1, Math.ceil((totalRows[0]?.count ?? 0) / desktopUserPageSize)),
		search: query.search,
		status: query.status,
		total: totalRows[0]?.count ?? 0,
		users
	};
}

export async function setDesktopUserStatus(
	userId: string,
	status: DesktopUserStatus
): Promise<boolean> {
	const updated = await db
		.update(desktopUser)
		.set({ status, updatedAt: new Date() })
		.where(eq(desktopUser.id, userId))
		.returning({ id: desktopUser.id });
	return updated.length > 0;
}
