import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const serverDirectory = fileURLToPath(new URL('../../..', import.meta.url));

describe('local RMS schema bootstrap', () => {
	it('loads local database settings from environment variables', () => {
		const localCompose = readFileSync(`${serverDirectory}/compose.local.yaml`, 'utf8');

		expect(localCompose).toContain("'${POSTGRES_HOST_PORT:?Set POSTGRES_HOST_PORT}:5432'");
		expect(localCompose).toContain('POSTGRES_USER: ${POSTGRES_USER:?Set POSTGRES_USER}');
		expect(localCompose).toContain(
			'POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD}'
		);
		expect(localCompose).toContain('POSTGRES_DB: ${POSTGRES_DB:?Set POSTGRES_DB}');
		expect(localCompose).toContain("'${RMS_HOST_PORT:?Set RMS_HOST_PORT}:3306'");
		expect(localCompose).toContain('MYSQL_DATABASE: ${MYSQL_DATABASE:?Set MYSQL_DATABASE}');
		expect(localCompose).toContain('MYSQL_USER: ${MYSQL_USER:?Set MYSQL_USER}');
		expect(localCompose).toContain('MYSQL_PASSWORD: ${MYSQL_PASSWORD:?Set MYSQL_PASSWORD}');
		expect(localCompose).toContain(
			'DATABASE_URL: ${COMPOSE_DATABASE_URL:?Set COMPOSE_DATABASE_URL}'
		);
		expect(localCompose).toContain('RMS_DATABASE_URL: ${COMPOSE_RMS_DATABASE_URL:-}');
		expect(localCompose).not.toContain('postgres://root:mysecretpassword');
		expect(localCompose).not.toContain('mysql://hotel_butler:mysecretpassword');
	});

	it('waits for the final PostgreSQL TCP server before running migrations', () => {
		const localCompose = readFileSync(`${serverDirectory}/compose.local.yaml`, 'utf8');

		expect(localCompose).toContain(
			'pg_isready -h 127.0.0.1 -U "$${POSTGRES_USER}" -d "$${POSTGRES_DB}"'
		);
	});

	it('mounts the development dump into MySQL initialization only in local Compose', () => {
		const localCompose = readFileSync(`${serverDirectory}/compose.local.yaml`, 'utf8');
		const productionCompose = readFileSync(`${serverDirectory}/compose.production.yaml`, 'utf8');
		const initializationMount =
			'./rms-schema.sql:/docker-entrypoint-initdb.d/001-rms-schema.sql:ro';

		expect(localCompose).toContain(initializationMount);
		expect(productionCompose).not.toContain('rms-schema.sql');
		expect(productionCompose).not.toContain('/docker-entrypoint-initdb.d');
	});

	it('seeds the active desktop experience employee used by the login screen', () => {
		const schema = readFileSync(`${serverDirectory}/rms-schema.sql`, 'utf8');

		expect(schema).toContain("'desktop-demo'");
		expect(schema).toContain("'桌面体验员工'");
		expect(schema).toContain("'13800138000'");
		expect(schema).toContain("'FRONT_DESK'");
		expect(schema).toMatch(
			/INSERT INTO `employee`[\s\S]*VALUES \(42,'desktop-demo','unused-phone-otp','桌面体验员工','13800138000','FRONT_DESK',1\)/
		);
	});
});
