import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const serverDirectory = fileURLToPath(new URL('../../..', import.meta.url));

function environmentKeys(source: string): string[] {
	return [...source.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]);
}

function composeInterpolationKeys(source: string): Set<string> {
	return new Set([...source.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)].map((match) => match[1]));
}

describe('deployment environment boundaries', () => {
	it('keeps production inputs minimal while allowing a future optional RMS identity source', () => {
		const example = readFileSync(`${serverDirectory}/.env.production.example`, 'utf8');
		const productionCompose = readFileSync(`${serverDirectory}/compose.production.yaml`, 'utf8');

		expect(example).toContain('XIAOZHI_RMS_SERVER_URL=');
		expect(example).not.toContain('XIAOZHI_AUTH_VARIANT=');
		expect(example).not.toContain('RMS_DATABASE_URL=');
		expect(example).not.toContain('AI_DMS_MCP_URL=');
		expect(productionCompose).toContain('RMS_DATABASE_URL: ${RMS_DATABASE_URL:-}');
	});

	it('does not inject the complete development env file into service containers', () => {
		const localCompose = readFileSync(`${serverDirectory}/compose.local.yaml`, 'utf8');

		expect(localCompose).not.toContain('env_file:');
		expect(localCompose).toContain(
			'BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET:?Set BETTER_AUTH_SECRET}'
		);
		expect(localCompose).toContain('RMS_DATABASE_URL: ${COMPOSE_RMS_DATABASE_URL:-}');
	});

	it('does not keep production example settings that Compose never reads', () => {
		const example = readFileSync(`${serverDirectory}/.env.production.example`, 'utf8');
		const productionCompose = readFileSync(`${serverDirectory}/compose.production.yaml`, 'utf8');
		const composeKeys = composeInterpolationKeys(productionCompose);

		expect(environmentKeys(example).filter((key) => !composeKeys.has(key))).toEqual([]);
	});

	it('persists production JSON logs in the prepared host directory', () => {
		const example = readFileSync(`${serverDirectory}/.env.production.example`, 'utf8');
		const productionCompose = readFileSync(`${serverDirectory}/compose.production.yaml`, 'utf8');
		const hostPreparation = readFileSync(
			`${serverDirectory}/scripts/prepare-production-host.sh`,
			'utf8'
		);

		expect(example).toContain('SERVER_LOG_DIR="/var/log/hotel-butler/server"');
		expect(productionCompose).toContain('SERVER_LOG_FILE: /var/log/hotel-butler/server.jsonl');
		expect(productionCompose).toContain('source: ${SERVER_LOG_DIR:?Set SERVER_LOG_DIR');
		expect(productionCompose).toContain('target: /var/log/hotel-butler');
		expect(productionCompose).toContain('max-size: 20m');
		expect(productionCompose).toContain('max-file: 5');
		expect(hostPreparation).toContain(
			'server_log_dir="${SERVER_LOG_DIR:-/var/log/hotel-butler/server}"'
		);
		expect(hostPreparation).toContain('maxsize 50M');
		expect(hostPreparation).toContain('rotate 14');
	});
});
