import { createPool } from 'mysql2/promise';

export function createRmsClient(databaseUrl: string) {
	return createPool({
		uri: databaseUrl,
		waitForConnections: true,
		connectionLimit: 10,
		maxIdle: 10,
		idleTimeout: 60_000,
		queueLimit: 0,
		enableKeepAlive: true,
		supportBigNumbers: true,
		bigNumberStrings: true
	});
}
