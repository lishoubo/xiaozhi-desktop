import assert from 'node:assert/strict';
import https from 'node:https';
import { createConnection } from 'mysql2/promise';
import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;
const rmsDatabaseUrl = process.env.RMS_DATABASE_URL;
const serverUrl = new URL(process.env.SERVER_URL ?? 'https://server:4173');

assert.ok(databaseUrl, 'DATABASE_URL is required');
assert.ok(rmsDatabaseUrl, 'RMS_DATABASE_URL is required');
assert.equal(serverUrl.protocol, 'https:', 'SERVER_URL must use HTTPS');

function requestHealth() {
	return new Promise((resolve, reject) => {
		const healthUrl = new URL('/api/trpc/system.health', serverUrl);
		const request = https.get(healthUrl, (response) => {
			response.resume();
			response.on('end', () => {
				if (response.statusCode === 200) resolve();
				else
					reject(new Error(`HTTPS health request returned ${response.statusCode ?? 'no status'}`));
			});
		});
		request.on('error', reject);
	});
}

const postgresClient = postgres(databaseUrl, { max: 1 });
const rmsClient = await createConnection(rmsDatabaseUrl);

try {
	const [postgresRows, adminRows, [rmsRows]] = await Promise.all([
		postgresClient`select 1 as value`,
		postgresClient`select username, role from "user" where role = 'superAdmin'`,
		rmsClient.query('select 1 as value'),
		requestHealth()
	]);

	assert.equal(postgresRows[0]?.value, 1);
	assert.equal(adminRows[0]?.username, 'admin');
	assert.equal(adminRows[0]?.role, 'superAdmin');
	assert.equal(rmsRows[0]?.value, 1);
	console.info('Compose connectivity verified: HTTPS server, PostgreSQL, and RMS MySQL');
} finally {
	await Promise.all([postgresClient.end(), rmsClient.end()]);
}
