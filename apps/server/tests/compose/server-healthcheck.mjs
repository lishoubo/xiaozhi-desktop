import http from 'node:http';
import https from 'node:https';

const healthUrl = new URL(
	process.env.SERVER_HEALTH_URL ?? 'https://localhost:4173/api/trpc/system.health'
);
const client = healthUrl.protocol === 'https:' ? https : http;

const request = client.get(healthUrl, (response) => {
	response.resume();
	if (response.statusCode !== 200) {
		process.exitCode = 1;
	}
});

request.on('error', () => {
	process.exitCode = 1;
});
