import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const serverDirectory = fileURLToPath(new URL('../../..', import.meta.url));

describe('local RMS schema bootstrap', () => {
	it('mounts the development dump into MySQL initialization only in local Compose', () => {
		const localCompose = readFileSync(`${serverDirectory}/compose.local.yaml`, 'utf8');
		const productionCompose = readFileSync(`${serverDirectory}/compose.production.yaml`, 'utf8');
		const initializationMount =
			'./rms-schema.sql:/docker-entrypoint-initdb.d/001-rms-schema.sql:ro';

		expect(localCompose).toContain(initializationMount);
		expect(productionCompose).not.toContain('rms-schema.sql');
		expect(productionCompose).not.toContain('/docker-entrypoint-initdb.d');
	});
});
