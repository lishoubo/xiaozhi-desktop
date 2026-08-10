import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const desktopSession = pgTable(
	'desktop_session',
	{
		id: text('id').primaryKey(),
		tokenDigest: text('token_digest').notNull().unique(),
		employeeId: text('employee_id').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull()
	},
	(table) => [
		index('desktopSession_employeeId_idx').on(table.employeeId),
		index('desktopSession_expiresAt_idx').on(table.expiresAt)
	]
);
