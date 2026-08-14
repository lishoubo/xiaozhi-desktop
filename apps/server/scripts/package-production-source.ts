import { execFileSync } from 'node:child_process';
import { createHash, createPublicKey, X509Certificate } from 'node:crypto';
import {
	chmodSync,
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const archivePrefix = 'hotel-butler/app/';
const deploymentRoot = 'hotel-butler/';
const productionIp = '121.199.29.74';
const productionEnvironmentEntry = `${archivePrefix}apps/server/.env.production`;
const productionTlsEntries = [
	`${deploymentRoot}tls/server/ca.pem`,
	`${deploymentRoot}tls/server/cert.pem`,
	`${deploymentRoot}tls/server/key.pem`
] as const;
const deploymentDirectoryEntries = new Set([
	'hotel-butler',
	'hotel-butler/app',
	'hotel-butler/tls',
	'hotel-butler/tls/server'
]);
const archivePaths = [
	'package.json',
	'package-lock.json',
	'.dockerignore',
	'apps/server',
	'packages/api'
] as const;
const generatedSegments = new Set([
	'.cert',
	'.e2e',
	'.git',
	'.svelte-kit',
	'build',
	'coverage',
	'dist',
	'logs',
	'node_modules',
	'out',
	'output',
	'playwright-report',
	'test-results',
	'uploads'
]);
const requiredEntries = [
	`${archivePrefix}.dockerignore`,
	`${archivePrefix}package.json`,
	`${archivePrefix}package-lock.json`,
	`${archivePrefix}apps/server/Dockerfile`,
	`${archivePrefix}apps/server/compose.production.yaml`,
	`${archivePrefix}apps/server/scripts/start-production-https.mjs`,
	`${archivePrefix}packages/api/package.json`
] as const;

function git(arguments_: readonly string[]): string {
	return execFileSync('git', arguments_, {
		cwd: repositoryRoot,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe']
	});
}

export function archiveEntryIsForbidden(entry: string): boolean {
	const normalized = entry.replace(/^\.\//, '').replace(/\/$/, '');
	const relative = normalized.startsWith(archivePrefix)
		? normalized.slice(archivePrefix.length)
		: normalized;
	if (!relative) return false;
	const segments = relative.split('/');
	if (segments.some((segment) => generatedSegments.has(segment))) return true;
	const basename = segments.at(-1) ?? '';
	if (basename === '.env.production.example') return false;
	if (basename === '.env' || basename.startsWith('.env.')) return true;
	if (basename === '.npmrc') return true;
	return /\.(?:cer|crt|der|key|pem|p12|pfx)$/i.test(basename);
}

export function validateArchiveEntries(entries: readonly string[]): void {
	const forbidden = entries.filter(archiveEntryIsForbidden);
	if (forbidden.length > 0) {
		throw new Error(`Deployment archive contains forbidden entries: ${forbidden.join(', ')}`);
	}
	const entrySet = new Set(entries.map((entry) => entry.replace(/\/$/, '')));
	const missing = requiredEntries.filter((entry) => !entrySet.has(entry));
	if (missing.length > 0) {
		throw new Error(`Deployment archive is missing required entries: ${missing.join(', ')}`);
	}
}

export function validateDeploymentArchiveEntries(entries: readonly string[]): void {
	const normalizedEntries = entries.map((entry) => entry.replace(/^\.\//, '').replace(/\/$/, ''));
	const allowedRuntimeEntries = new Set([productionEnvironmentEntry, ...productionTlsEntries]);
	const unexpected = normalizedEntries.filter(
		(entry) =>
			entry &&
			!entry.startsWith(archivePrefix) &&
			!deploymentDirectoryEntries.has(entry) &&
			!allowedRuntimeEntries.has(entry)
	);
	if (unexpected.length > 0) {
		throw new Error(`Deployment bundle contains unexpected entries: ${unexpected.join(', ')}`);
	}

	const sourceEntries = entries.filter(
		(entry) => !allowedRuntimeEntries.has(entry.replace(/^\.\//, '').replace(/\/$/, ''))
	);
	validateArchiveEntries(sourceEntries);
	const entrySet = new Set(normalizedEntries);
	const missing = [...allowedRuntimeEntries].filter((entry) => !entrySet.has(entry));
	if (missing.length > 0) {
		throw new Error(`Deployment bundle is missing runtime entries: ${missing.join(', ')}`);
	}
}

export function validateProductionEnvironmentText(environment: string): void {
	if (/replace[-_]with|example\.com|replace-with-rms-api-domain/i.test(environment)) {
		throw new Error('Production environment still contains placeholder values');
	}
	for (const requiredKey of [
		'POSTGRES_PASSWORD',
		'DATABASE_URL',
		'XIAOZHI_RMS_SERVER_URL',
		'BETTER_AUTH_SECRET',
		'AI_KIMI_API_KEY',
		'INITIAL_ADMIN_PASSWORD'
	]) {
		if (!new RegExp(`^${requiredKey}=.+$`, 'm').test(environment)) {
			throw new Error(`Production environment is missing ${requiredKey}`);
		}
	}
}

function assertNoUnexpectedPrivateKeys(directory: string, allowedPrivateKey?: string): void {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const entryPath = path.join(directory, entry.name);
		if (entry.isSymbolicLink()) {
			throw new Error(`Deployment archive contains a symbolic link: ${entryPath}`);
		}
		if (entry.isDirectory()) {
			assertNoUnexpectedPrivateKeys(entryPath, allowedPrivateKey);
			continue;
		}
		if (
			entry.isFile() &&
			path.resolve(entryPath) !== allowedPrivateKey &&
			readFileSync(entryPath).includes(Buffer.from('PRIVATE KEY-----'))
		) {
			throw new Error(`Deployment archive contains private key material: ${entryPath}`);
		}
	}
}

function publicKeyDer(key: ReturnType<typeof createPublicKey>): string {
	return key.export({ type: 'spki', format: 'der' }).toString('base64');
}

function validateServerTlsMaterial(directory: string): void {
	const caPath = path.join(directory, 'ca.pem');
	const certificatePath = path.join(directory, 'cert.pem');
	const keyPath = path.join(directory, 'key.pem');
	for (const requiredPath of [caPath, certificatePath, keyPath]) {
		if (!existsSync(requiredPath)) throw new Error(`Missing production TLS file: ${requiredPath}`);
	}
	if ((lstatSync(keyPath).mode & 0o077) !== 0) {
		throw new Error(
			'Production server private key permissions must not allow group or other access'
		);
	}

	const ca = new X509Certificate(readFileSync(caPath));
	const certificate = new X509Certificate(readFileSync(certificatePath));
	const now = Date.now();
	for (const [label, value] of [
		['Production CA', ca],
		['Production server certificate', certificate]
	] as const) {
		if (now < Date.parse(value.validFrom) || now > Date.parse(value.validTo)) {
			throw new Error(`${label} is not currently valid`);
		}
	}
	if (!ca.ca || certificate.ca) throw new Error('Production TLS certificate purposes are invalid');
	if (certificate.checkIP(productionIp) !== productionIp) {
		throw new Error(`Production server certificate is not valid for ${productionIp}`);
	}
	if (!certificate.verify(ca.publicKey)) {
		throw new Error('Production server certificate does not chain to the production CA');
	}
	if (
		publicKeyDer(certificate.publicKey) !==
		publicKeyDer(createPublicKey(readFileSync(keyPath, 'utf8')))
	) {
		throw new Error('Production server certificate and private key do not match');
	}
}

export function packageProductionSource(): Readonly<{
	archivePath: string;
	checksumPath: string;
}> {
	const includeRuntime = process.argv[2] === '--include-runtime';
	if (process.argv.length > (includeRuntime ? 3 : 2)) {
		throw new Error('This command accepts only the optional --include-runtime argument');
	}
	const dirty = git(['status', '--porcelain=v1', '--untracked-files=all']).trim();
	if (dirty) {
		throw new Error('Refusing to package production source from a dirty Git worktree');
	}
	const revision = git(['rev-parse', '--short=12', 'HEAD']).trim();
	if (!/^[0-9a-f]{7,40}$/i.test(revision)) throw new Error('Could not resolve the Git revision');
	const outputDirectory = path.join(repositoryRoot, 'output', 'deploy');
	const artifactName = includeRuntime
		? `hotel-butler-server-deployment-${revision}.tar.gz`
		: `hotel-butler-server-${revision}.tar.gz`;
	const archivePath = path.join(outputDirectory, artifactName);
	const checksumPath = `${archivePath}.sha256`;
	if (existsSync(archivePath) || existsSync(checksumPath)) {
		throw new Error(`Refusing to overwrite an existing deployment artifact for ${revision}`);
	}

	mkdirSync(outputDirectory, { recursive: true, mode: 0o755 });
	const stagingDirectory = mkdtempSync(path.join(outputDirectory, '.staging-'));
	try {
		const stagedArchive = path.join(stagingDirectory, 'source.tar.gz');
		const extractedDirectory = path.join(stagingDirectory, 'scan');
		execFileSync(
			'git',
			[
				'archive',
				'--format=tar.gz',
				`--prefix=${archivePrefix}`,
				`--output=${stagedArchive}`,
				'HEAD',
				'--',
				...archivePaths
			],
			{ cwd: repositoryRoot, stdio: 'inherit' }
		);
		const entries = execFileSync('tar', ['-tzf', stagedArchive], { encoding: 'utf8' })
			.split('\n')
			.filter(Boolean);
		validateArchiveEntries(entries);
		mkdirSync(extractedDirectory, { mode: 0o700 });
		execFileSync('tar', ['-xzf', stagedArchive, '-C', extractedDirectory], { stdio: 'inherit' });

		let stagedArtifact = stagedArchive;
		if (includeRuntime) {
			const environmentPath = path.join(repositoryRoot, 'apps/server/.env.production');
			if (!existsSync(environmentPath)) {
				throw new Error('Missing apps/server/.env.production; generate and complete it first');
			}
			if ((lstatSync(environmentPath).mode & 0o077) !== 0) {
				throw new Error('.env.production permissions must not allow group or other access');
			}
			validateProductionEnvironmentText(readFileSync(environmentPath, 'utf8'));

			const tlsSource = path.join(repositoryRoot, 'output/production-tls', productionIp, 'server');
			validateServerTlsMaterial(tlsSource);
			const environmentTarget = path.join(extractedDirectory, productionEnvironmentEntry);
			const tlsTarget = path.join(extractedDirectory, deploymentRoot, 'tls/server');
			mkdirSync(path.dirname(environmentTarget), { recursive: true, mode: 0o750 });
			mkdirSync(tlsTarget, { recursive: true, mode: 0o750 });
			copyFileSync(environmentPath, environmentTarget);
			chmodSync(environmentTarget, 0o600);
			for (const fileName of ['ca.pem', 'cert.pem', 'key.pem'] as const) {
				const target = path.join(tlsTarget, fileName);
				copyFileSync(path.join(tlsSource, fileName), target);
				chmodSync(target, fileName === 'key.pem' ? 0o600 : 0o644);
			}

			stagedArtifact = path.join(stagingDirectory, 'deployment.tar.gz');
			execFileSync('tar', [
				'-czf',
				stagedArtifact,
				'-C',
				extractedDirectory,
				deploymentRoot.replace(/\/$/, '')
			]);
			const deploymentEntries = execFileSync('tar', ['-tzf', stagedArtifact], {
				encoding: 'utf8'
			})
				.split('\n')
				.filter(Boolean);
			validateDeploymentArchiveEntries(deploymentEntries);
			assertNoUnexpectedPrivateKeys(extractedDirectory, path.resolve(tlsTarget, 'key.pem'));
		} else {
			assertNoUnexpectedPrivateKeys(extractedDirectory);
		}

		const checksum = createHash('sha256').update(readFileSync(stagedArtifact)).digest('hex');
		const stagedChecksum = path.join(stagingDirectory, 'source.tar.gz.sha256');
		writeFileSync(stagedChecksum, `${checksum}  ${path.basename(archivePath)}\n`, {
			encoding: 'utf8',
			mode: 0o644,
			flag: 'wx'
		});
		chmodSync(stagedArtifact, includeRuntime ? 0o600 : 0o644);
		renameSync(stagedArtifact, archivePath);
		renameSync(stagedChecksum, checksumPath);
		return { archivePath, checksumPath };
	} finally {
		if (existsSync(stagingDirectory) && lstatSync(stagingDirectory).isDirectory()) {
			rmSync(stagingDirectory, { recursive: true, force: true });
		}
	}
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
	try {
		const result = packageProductionSource();
		console.info(`Production source archive: ${result.archivePath}`);
		console.info(`SHA-256 checksum: ${result.checksumPath}`);
		if (process.argv[2] === '--include-runtime') {
			console.info('Sensitive deployment bundle includes .env.production and server TLS material.');
		} else {
			console.info('Transfer .env.production and server TLS files separately.');
		}
	} catch (cause: unknown) {
		console.error(cause instanceof Error ? cause.message : String(cause));
		process.exitCode = 1;
	}
}
