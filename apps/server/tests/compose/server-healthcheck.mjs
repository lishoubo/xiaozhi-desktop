import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { checkServerIdentity } from 'node:tls';

const healthUrl = new URL(
	process.env.SERVER_HEALTH_URL ?? 'https://localhost:4173/api/trpc/system.health'
);
const client = healthUrl.protocol === 'https:' ? https : http;

const connectAddress = process.env.SERVER_HEALTH_CONNECT_ADDRESS;
const connectPort = process.env.SERVER_HEALTH_CONNECT_PORT;
const caFile = process.env.SERVER_HEALTH_CA_FILE;
if (connectAddress && !isIP(connectAddress)) {
	throw new Error('SERVER_HEALTH_CONNECT_ADDRESS must be an IP address');
}

let completed = false;
let hardDeadline;

function finish(exitCode, message) {
	if (completed) return;
	completed = true;
	if (hardDeadline) clearTimeout(hardDeadline);
	if (message) console.error(message);
	process.exit(exitCode);
}

const requestOptions = {
	agent: false,
	ca: caFile ? readFileSync(caFile) : undefined,
	checkServerIdentity:
		healthUrl.protocol === 'https:'
			? (_hostname, certificate) => checkServerIdentity(healthUrl.hostname, certificate)
			: undefined,
	headers: { connection: 'close', host: healthUrl.host },
	hostname: connectAddress ?? healthUrl.hostname,
	path: `${healthUrl.pathname}${healthUrl.search}`,
	port: connectPort || healthUrl.port,
	servername:
		healthUrl.protocol === 'https:' && !isIP(healthUrl.hostname) ? healthUrl.hostname : undefined
};

hardDeadline = setTimeout(() => {
	finish(1, 'Server healthcheck failed: hard deadline exceeded after 4000ms');
}, 4_000);

const request = client.get(requestOptions, (response) => {
	const statusCode = response.statusCode;
	response.once('end', () => {
		finish(
			statusCode === 200 ? 0 : 1,
			statusCode === 200 ? undefined : `Server healthcheck failed: HTTP ${statusCode ?? 'unknown'}`
		);
	});
	response.resume();
});

request.setTimeout(3_500, () => {
	request.destroy(new Error('request timed out after 3500ms'));
});
request.on('error', (error) => {
	finish(1, `Server healthcheck failed: ${error.message}`);
});
