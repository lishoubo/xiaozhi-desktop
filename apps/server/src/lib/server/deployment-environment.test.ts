import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const serverDirectory = fileURLToPath(new URL('../../..', import.meta.url));

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
});
