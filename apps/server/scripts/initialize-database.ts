import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hashPassword } from 'better-auth/crypto';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { adminAccount, adminUser } from '../src/lib/server/db/auth.schema.ts';

const serverDirectory = fileURLToPath(new URL('..', import.meta.url));

export interface InitialAdminConfig {
	name: string;
	password: string;
	username: string;
}

export function readInitialAdminConfig(environment: NodeJS.ProcessEnv): InitialAdminConfig {
	if (
		environment.NODE_ENV === 'production' &&
		(!environment.INITIAL_ADMIN_USERNAME ||
			!environment.INITIAL_ADMIN_PASSWORD ||
			!environment.INITIAL_ADMIN_NAME)
	) {
		throw new Error(
			'Production requires INITIAL_ADMIN_USERNAME, INITIAL_ADMIN_PASSWORD, and INITIAL_ADMIN_NAME'
		);
	}

	const name = (environment.INITIAL_ADMIN_NAME ?? '本地管理员').trim();
	const password = environment.INITIAL_ADMIN_PASSWORD ?? 'admin123';
	const username = (environment.INITIAL_ADMIN_USERNAME ?? 'admin').trim().toLowerCase();

	if (!name) throw new Error('INITIAL_ADMIN_NAME is required');
	if (!/^[a-z0-9_]{3,30}$/.test(username)) {
		throw new Error(
			'INITIAL_ADMIN_USERNAME must contain 3-30 lowercase letters, numbers, or underscores'
		);
	}
	if (password.length < 8)
		throw new Error('INITIAL_ADMIN_PASSWORD must contain at least 8 characters');
	if (
		environment.NODE_ENV === 'production' &&
		(username.length < 8 ||
			password.length < 16 ||
			!/[a-z]/.test(password) ||
			!/[A-Z]/.test(password) ||
			!/[0-9]/.test(password) ||
			!/[\W_]/.test(password))
	) {
		throw new Error('Production administrator credentials do not meet the strength requirements');
	}

	return { name, password, username };
}

export function temporaryEmailForUsername(username: string): string {
	const fingerprint = createHash('sha256').update(username).digest('hex').slice(0, 20);
	return `initial-admin-${fingerprint}@account.invalid`;
}

export async function initializeDatabase(environment: NodeJS.ProcessEnv): Promise<void> {
	const databaseUrl = environment.DATABASE_URL;
	if (!databaseUrl) throw new Error('DATABASE_URL is required');
	const admin = readInitialAdminConfig(environment);
	const client = postgres(databaseUrl, { max: 1 });
	const database = drizzle(client);

	try {
		await migrate(database, { migrationsFolder: path.join(serverDirectory, 'drizzle') });
		const inserted = await database.transaction(async (transaction) => {
			const userId = randomUUID();
			const insertedUsers = await transaction
				.insert(adminUser)
				.values({
					displayUsername: admin.username,
					email: temporaryEmailForUsername(admin.username),
					emailVerified: false,
					id: userId,
					name: admin.name,
					username: admin.username
				})
				.onConflictDoNothing({ target: adminUser.username })
				.returning({ id: adminUser.id });
			if (insertedUsers.length === 0) return false;

			await transaction.insert(adminAccount).values({
				accountId: userId,
				id: randomUUID(),
				password: await hashPassword(admin.password),
				providerId: 'credential',
				userId
			});
			return true;
		});
		if (!inserted) {
			const existingUsers = await database
				.select({ id: adminUser.id })
				.from(adminUser)
				.where(eq(adminUser.username, admin.username))
				.limit(1);
			const existingUser = existingUsers[0];
			if (!existingUser) throw new Error('Initial administrator could not be loaded');
			const credentials = await database
				.select({ id: adminAccount.id })
				.from(adminAccount)
				.where(
					and(eq(adminAccount.userId, existingUser.id), eq(adminAccount.providerId, 'credential'))
				)
				.limit(1);
			if (credentials.length === 0) {
				throw new Error('Initial administrator exists without username/password credentials');
			}
		}

		console.info(
			inserted ? 'Initial administrator created' : 'Initial administrator already exists'
		);
	} finally {
		await client.end();
	}
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
	initializeDatabase(process.env).catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : 'Database initialization failed');
		process.exitCode = 1;
	});
}
