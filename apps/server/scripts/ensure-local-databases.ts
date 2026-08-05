import { execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const serverDirectory = fileURLToPath(new URL('..', import.meta.url));
const requiredServices = ['db', 'rms'] as const;

export function missingLocalDatabaseServices(runningServices: string): string[] {
	const running = new Set(
		runningServices
			.split(/\r?\n/)
			.map((service) => service.trim())
			.filter(Boolean)
	);
	return requiredServices.filter((service) => !running.has(service));
}

export async function ensureLocalDatabases(): Promise<void> {
	const composeArguments = ['compose', '-f', 'compose.local.yaml'];
	const { stdout } = await execFileAsync(
		'docker',
		[...composeArguments, 'ps', '--status', 'running', '--services'],
		{ cwd: serverDirectory }
	);
	const missingServices = missingLocalDatabaseServices(stdout);
	if (missingServices.length === 0) {
		console.info('Local PostgreSQL and RMS MySQL are already running; leaving them unchanged.');
		return;
	}

	console.info(`Starting missing local database services: ${missingServices.join(', ')}`);
	await execFileAsync(
		'docker',
		[...composeArguments, 'up', '--detach', '--wait', ...missingServices],
		{ cwd: serverDirectory }
	);
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
	ensureLocalDatabases().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : 'Failed to start local databases');
		process.exitCode = 1;
	});
}
