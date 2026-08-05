import { boolean, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const desktopUserStatuses = ['active', 'disabled'] as const;
export type DesktopUserStatus = (typeof desktopUserStatuses)[number];

export const desktopUser = pgTable(
	'desktop_user',
	{
		id: text('id').primaryKey(),
		phoneNumber: text('phone_number').notNull().unique(),
		displayName: text('display_name'),
		phoneNumberVerified: boolean('phone_number_verified').notNull().default(false),
		status: text('status').$type<DesktopUserStatus>().notNull().default('active'),
		lastLoginAt: timestamp('last_login_at'),
		createdAt: timestamp('created_at').notNull().defaultNow(),
		updatedAt: timestamp('updated_at')
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date())
	},
	(table) => [
		index('desktop_user_status_idx').on(table.status),
		index('desktop_user_created_at_idx').on(table.createdAt)
	]
);
