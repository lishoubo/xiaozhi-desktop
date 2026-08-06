import { env } from '$env/dynamic/private';
import { drizzle } from 'drizzle-orm/mysql2';
import { createPool } from 'mysql2/promise';

if (!env.RMS_DATABASE_URL) throw new Error('RMS_DATABASE_URL is not set');

export const rmsClient = createPool({
	uri: env.RMS_DATABASE_URL,
	waitForConnections: true,
	connectionLimit: 10,
	maxIdle: 10,
	idleTimeout: 60_000,
	queueLimit: 0,
	enableKeepAlive: true,
	supportBigNumbers: true,
	bigNumberStrings: true
});

export const rmsDb = drizzle({ client: rmsClient });
