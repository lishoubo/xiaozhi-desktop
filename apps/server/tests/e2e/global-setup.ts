import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createConnection } from 'mysql2/promise';
import { promisify } from 'node:util';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { e2ePostgresHostPort, e2eRmsHostPort } from './ports';

const execFileAsync = promisify(execFile);
const postgresPort = 5432;
const rmsPort = 3306;
const rmsSchemaPath = fileURLToPath(new URL('../../rms-schema.sql', import.meta.url));

function databaseUrl(
	protocol: 'postgres' | 'mysql',
	container: StartedTestContainer,
	port: number,
	username: string,
	password: string,
	database: string
): string {
	const url = new URL(`${protocol}://localhost`);
	url.hostname = container.getHost();
	url.port = container.getMappedPort(port).toString();
	url.username = username;
	url.password = password;
	url.pathname = database;
	return url.toString();
}

async function stopContainers(containers: StartedTestContainer[]): Promise<void> {
	const results = await Promise.allSettled(containers.map((container) => container.stop()));
	const errors = results
		.filter((result) => result.status === 'rejected')
		.map((result) => result.reason);

	if (errors.length > 0) {
		throw new AggregateError(errors, 'Failed to stop one or more e2e database containers');
	}
}

export default async function globalSetup(): Promise<() => Promise<void>> {
	const containers: StartedTestContainer[] = [];

	try {
		const postgres = await new GenericContainer('pgvector/pgvector:0.8.5-pg18')
			.withEnvironment({
				POSTGRES_USER: 'root',
				POSTGRES_PASSWORD: 'testpassword',
				POSTGRES_DB: 'test'
			})
			.withExposedPorts({ container: postgresPort, host: e2ePostgresHostPort })
			.withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
			.withStartupTimeout(120_000)
			.start();
		containers.push(postgres);

		const rms = await new GenericContainer('mysql:8.4')
			.withEnvironment({
				MYSQL_ROOT_PASSWORD: 'testrootpassword',
				MYSQL_DATABASE: 'rms',
				MYSQL_USER: 'hotel_butler',
				MYSQL_PASSWORD: 'testpassword'
			})
			.withCommand(['--character-set-server=utf8mb4', '--collation-server=utf8mb4_0900_ai_ci'])
			.withCopyFilesToContainer([
				{ source: rmsSchemaPath, target: '/docker-entrypoint-initdb.d/001-rms-schema.sql' }
			])
			.withExposedPorts({ container: rmsPort, host: e2eRmsHostPort })
			.withWaitStrategy(Wait.forLogMessage(/ready for connections.*port: 3306/i))
			.withStartupTimeout(120_000)
			.start();
		containers.push(rms);

		process.env.DATABASE_URL = databaseUrl(
			'postgres',
			postgres,
			postgresPort,
			'root',
			'testpassword',
			'test'
		);
		process.env.RMS_DATABASE_URL = databaseUrl(
			'mysql',
			rms,
			rmsPort,
			'hotel_butler',
			'testpassword',
			'rms'
		);
		process.env.INITIAL_ADMIN_NAME = 'E2E Administrator';
		process.env.INITIAL_ADMIN_PASSWORD = 'admin123';
		process.env.INITIAL_ADMIN_USERNAME = 'admin';

		const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
		await execFileAsync(npmCommand, ['run', 'db:initialize'], {
			env: process.env,
			maxBuffer: 10 * 1024 * 1024
		});
		const rmsDatabase = await createConnection(process.env.RMS_DATABASE_URL);
		try {
			await rmsDatabase.execute(
				`INSERT INTO employee (
					org_id, username, password_hash, full_name, phone, role_code, status
				) VALUES (?, ?, ?, ?, ?, ?, ?)`,
				[42, 'desktop-e2e-user', 'unused-e2e-hash', '测试桌面员工', '13800138000', 'FRONT_DESK', 1]
			);
		} finally {
			await rmsDatabase.end();
		}
	} catch (error) {
		try {
			await stopContainers(containers);
		} catch (cleanupError) {
			throw new AggregateError(
				[error, cleanupError],
				'E2e database setup and cleanup both failed',
				{
					cause: cleanupError
				}
			);
		}
		throw error;
	}

	return () => stopContainers(containers);
}
