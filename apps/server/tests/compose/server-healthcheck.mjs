import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';

const healthUrl = new URL(
	process.env.SERVER_HEALTH_URL ?? 'https://localhost:4173/api/trpc/system.health'
);
const client = healthUrl.protocol === 'https:' ? https : http;

const connectAddress = process.env.SERVER_HEALTH_CONNECT_ADDRESS;
const connectPort = process.env.SERVER_HEALTH_CONNECT_PORT;
const caFile = process.env.SERVER_HEALTH_CA_FILE;
const request = client.get(
	connectAddress
		? {
				hostname: healthUrl.hostname,
				port: connectPort || healthUrl.port,
				path: `${healthUrl.pathname}${healthUrl.search}`,
				ca: caFile ? readFileSync(caFile) : undefined,
				lookup: (_hostname, _options, callback) => callback(null, connectAddress, 4)
			}
		: healthUrl,
	(response) => {
		response.resume();
		if (response.statusCode !== 200) {
			process.exitCode = 1;
		}
	}
);

request.on('error', () => {
	process.exitCode = 1;
});
