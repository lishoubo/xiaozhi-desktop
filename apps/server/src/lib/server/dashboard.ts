import { count, desc, eq, gte } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { desktopUser } from '$lib/server/db/desktop-user.schema';

const recentRegistrationDays = 7;

export function recentRegistrationStart(now: Date): Date {
	return new Date(now.getTime() - recentRegistrationDays * 24 * 60 * 60 * 1000);
}

export async function getDashboardData(now = new Date()) {
	const recentStart = recentRegistrationStart(now);
	const [totalRows, verifiedRows, disabledRows, recentRows, recentUsers] = await Promise.all([
		db.select({ count: count() }).from(desktopUser),
		db
			.select({ count: count() })
			.from(desktopUser)
			.where(eq(desktopUser.phoneNumberVerified, true)),
		db.select({ count: count() }).from(desktopUser).where(eq(desktopUser.status, 'disabled')),
		db.select({ count: count() }).from(desktopUser).where(gte(desktopUser.createdAt, recentStart)),
		db
			.select({
				createdAt: desktopUser.createdAt,
				displayName: desktopUser.displayName,
				id: desktopUser.id,
				phoneNumber: desktopUser.phoneNumber,
				status: desktopUser.status
			})
			.from(desktopUser)
			.orderBy(desc(desktopUser.createdAt))
			.limit(5)
	]);

	return {
		metrics: {
			disabled: disabledRows[0]?.count ?? 0,
			recent: recentRows[0]?.count ?? 0,
			total: totalRows[0]?.count ?? 0,
			verified: verifiedRows[0]?.count ?? 0
		},
		recentUsers
	};
}
