import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';

const healthUrl = new URL(
	process.env.SERVER_HEALTH_URL ?? 'https://localhost:4173/api/trpc/system.health'
);
const client = healthUrl.protocol === 'https:' ? https : http;

const connectAddress = process.env.SERVER_HEALTH_CONNECT_ADDRESS;
const connectPort = process.env.SERVER_HEALTH_CONNECT_PORT;
const caFile = process.env.SERVER_HEALTH_CA_FILE;
const requestOptions = {
	agent: false,
	ca: caFile ? readFileSync(caFile) : undefined,
	headers: { connection: 'close' },
	hostname: healthUrl.hostname,
	path: `${healthUrl.pathname}${healthUrl.search}`,
	port: connectPort || healthUrl.port
};
if (connectAddress) {
	const family = isIP(connectAddress);
	if (!family) throw new Error('SERVER_HEALTH_CONNECT_ADDRESS must be an IP address');
	requestOptions.lookup = (_hostname, options, callback) => {
		if (options?.all) {
			callback(null, [{ address: connectAddress, family }]);
			return;
		}
		callback(null, connectAddress, family);
	};
}

const request = client.get(requestOptions, (response) => {
	response.resume();
	if (response.statusCode !== 200) {
		console.error(`Server healthcheck failed: HTTP ${response.statusCode ?? 'unknown'}`);
		process.exitCode = 1;
	}
});

request.setTimeout(4_000, () => {
	request.destroy(new Error('request timed out after 4000ms'));
});
request.on('error', (error) => {
	console.error('Server healthcheck failed:', error.message);
	process.exitCode = 1;
});
