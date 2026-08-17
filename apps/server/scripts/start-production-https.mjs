import { readFileSync } from 'node:fs';
import https from 'node:https';
import { handler } from '../build/handler.js';

const certificateFile = process.env.SERVER_TLS_CERT_FILE;
const keyFile = process.env.SERVER_TLS_KEY_FILE;
if (!certificateFile || !keyFile) {
	throw new Error('SERVER_TLS_CERT_FILE and SERVER_TLS_KEY_FILE are required');
}

const host = process.env.HOST ?? '0.0.0.0';
const port = Number.parseInt(process.env.PORT ?? '3443', 10);
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
	throw new Error('PORT must be a valid TCP port');
}

const server = https.createServer(
	{
		cert: readFileSync(certificateFile),
		key: readFileSync(keyFile),
		minVersion: 'TLSv1.2'
	},
	handler
);
server.listen(port, host, () => console.info(`HTTPS server listening on ${host}:${port}`));

function shutdown() {
	server.closeAllConnections();
	server.close((error) => {
		if (error) {
			console.error('HTTPS server shutdown failed', error);
			process.exitCode = 1;
		}
	});
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
