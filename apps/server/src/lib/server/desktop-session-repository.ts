import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { desktopSession } from '$lib/server/db/desktop-session.schema';
import type {
	DesktopSessionCreate,
	DesktopSessionRecord,
	DesktopSessionRepository
} from './desktop-session';

export class DrizzleDesktopSessionRepository implements DesktopSessionRepository {
	constructor(private readonly database: typeof db) {}

	async create(session: DesktopSessionCreate): Promise<void> {
		await this.database.insert(desktopSession).values(session);
	}

	async deleteByTokenDigest(tokenDigest: string): Promise<void> {
		await this.database.delete(desktopSession).where(eq(desktopSession.tokenDigest, tokenDigest));
	}

	async findByTokenDigest(tokenDigest: string): Promise<DesktopSessionRecord | null> {
		const rows = await this.database
			.select({
				employeeId: desktopSession.employeeId,
				expiresAt: desktopSession.expiresAt,
				tokenDigest: desktopSession.tokenDigest
			})
			.from(desktopSession)
			.where(eq(desktopSession.tokenDigest, tokenDigest))
			.limit(1);
		return rows[0] ?? null;
	}
}
