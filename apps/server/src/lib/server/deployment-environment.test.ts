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
		expect(example).toContain('AI_DMS_DATABASE_ID="81918192"');
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

	it('exposes the local Compose server on the same port as host development', () => {
		const localCompose = readFileSync(`${serverDirectory}/compose.local.yaml`, 'utf8');

		expect(localCompose).toContain('ORIGIN: https://localhost:${SERVER_HTTPS_PORT:-5173}');
		expect(localCompose).toContain("'${SERVER_HTTPS_PORT:-5173}:4173'");
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
		expect(hostPreparation).toContain('default_deploy_user="hotelbutler"');
		expect(hostPreparation).toContain('preferred_deploy_uid="${HOTEL_BUTLER_DEPLOY_UID:-2000}"');
		expect(hostPreparation).toContain('useradd --uid "${preferred_deploy_uid}" --user-group');
		expect(hostPreparation).toContain('--shell "${nologin_shell}" "${deploy_user}"');
		expect(hostPreparation).toContain('Deployment owner must not be root');
		expect(hostPreparation).toContain(
			'Deployment owner UID conflicts with the PostgreSQL container UID'
		);
		expect(hostPreparation).toContain('deploy_user_is_automatic=true');
		expect(hostPreparation).toContain('Existing automatic deployment owner has unexpected UID');
		expect(hostPreparation).toContain(
			'Existing automatic deployment owner must use a non-login shell'
		);
		expect(hostPreparation).toContain(
			'chown -R "${deploy_uid}:${deploy_group}" "${app_directory}"'
		);
		expect(hostPreparation).toContain('maxsize 50M');
		expect(hostPreparation).toContain('rotate 14');
	});

	it('uploads the current deployment bundle without weakening SSH verification', () => {
		const uploader = readFileSync(`${serverDirectory}/scripts/upload-production-bundle.sh`, 'utf8');

		expect(uploader).toContain('server_ip="121.199.29.74"');
		expect(uploader).toContain('apps/server/rms-agent-key.pem');
		expect(uploader).toContain('sha256sum -c');
		expect(uploader).toContain('.incoming-${revision}-${upload_id}');
		expect(uploader).toContain('mv -f');
		expect(uploader).toContain('current-release');
		expect(uploader).not.toContain('test ! -e');
		expect(uploader).not.toContain('StrictHostKeyChecking=no');
		expect(uploader).not.toContain('docker compose');
	});

	it('packages an amd64 image release without requiring source code on the host', () => {
		const packager = readFileSync(
			`${serverDirectory}/scripts/package-production-images.sh`,
			'utf8'
		);
		const productionCompose = readFileSync(`${serverDirectory}/compose.production.yaml`, 'utf8');

		expect(packager).toContain('target_platform="linux/amd64"');
		expect(packager).not.toContain('HOTEL_BUTLER_TARGET_PLATFORM');
		expect(packager).toContain('docker buildx build');
		expect(packager).toContain('--target production');
		expect(packager).toContain('--include-database-image');
		expect(packager).toContain('include_database_image=false');
		expect(packager).toContain('pgvector/pgvector:0.8.5-pg18');
		expect(packager).toContain('docker image save');
		expect(packager).toContain('current-image-release');
		expect(packager).toContain('COPYFILE_DISABLE=1 tar --no-xattrs');
		expect(packager).toContain('compose.production.yaml');
		expect(packager).toContain('.env.production');
		expect(packager).toContain('deploy-production-images.sh');
		expect(productionCompose).not.toContain('build:');
	});

	it('deploys offline images with a pre-migration database backup', () => {
		const deployer = readFileSync(`${serverDirectory}/scripts/deploy-production-images.sh`, 'utf8');
		const uploader = readFileSync(`${serverDirectory}/scripts/upload-production-images.sh`, 'utf8');

		expect(deployer).toContain('Alibaba Cloud Linux 4');
		expect(deployer).toContain('pg_dump');
		expect(deployer).toContain('--port "${POSTGRES_PORT:-35432}"');
		expect(deployer).toContain('docker image load');
		expect(deployer).toContain('Database image is unavailable on this ECS host');
		expect(deployer).toContain('--no-build');
		expect(deployer).toContain('--pull never');
		expect(deployer).toContain('--wait-timeout 360');
		expect(deployer).toContain('Server did not become healthy within the deployment wait window');
		expect(deployer).toContain('logs --no-color --tail 120 server');
		expect(deployer).toContain('docker compose');
		expect(uploader).toContain('sha256sum -c');
		expect(uploader).toContain('apps/server/rms-agent-key.pem');
		expect(uploader).toContain('platform_name="linux-amd64"');
		expect(uploader).toContain('current-image-release');
		expect(uploader).not.toContain('HOTEL_BUTLER_TARGET_PLATFORM');
		expect(uploader).not.toContain('StrictHostKeyChecking=no');
		expect(uploader).not.toContain('docker compose');
	});

	it('makes the container healthcheck terminate before the Docker timeout', () => {
		const healthcheck = readFileSync(
			`${serverDirectory}/tests/compose/server-healthcheck.mjs`,
			'utf8'
		);

		expect(healthcheck).toContain('agent: false');
		expect(healthcheck).toContain("connection: 'close'");
		expect(healthcheck).toContain('queueMicrotask');
		expect(healthcheck).toContain('request.setTimeout(3_500');
		expect(healthcheck).toContain("response.once('end'");
		expect(healthcheck).toContain('process.exit(exitCode)');
		expect(healthcheck).toContain('hard deadline exceeded after 4000ms');
	});
});
