import { X509Certificate } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, copyFile, mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { resolveConfig } from 'vite';
import mkcert from 'vite-plugin-mkcert';

const execFileAsync = promisify(execFile);
const renewalWindowDays = 30;
const millisecondsPerDay = 24 * 60 * 60 * 1000;
const serverDirectory = fileURLToPath(new URL('..', import.meta.url));
const certificateOutputDirectory = path.join(serverDirectory, '.cert');
const mkcertStoreDirectory = path.join(homedir(), '.hotel-butler-mkcert');
const certificateHosts = ['localhost', '127.0.0.1', '::1', 'server'];

export function certificateNeedsRenewal(
	validTo: string,
	now: Date,
	renewBeforeDays = renewalWindowDays
): boolean {
	const expiresAt = Date.parse(validTo);
	if (Number.isNaN(expiresAt)) throw new Error(`Invalid certificate expiration date: ${validTo}`);
	return expiresAt - now.getTime() <= renewBeforeDays * millisecondsPerDay;
}

async function readCertificate(filePath: string): Promise<X509Certificate | undefined> {
	try {
		return new X509Certificate(await readFile(filePath));
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
		throw error;
	}
}

async function copyPublicRuntimeCertificates(): Promise<void> {
	await mkdir(certificateOutputDirectory, { recursive: true, mode: 0o700 });
	for (const fileName of ['cert.pem', 'rootCA.pem']) {
		await copyFile(
			path.join(mkcertStoreDirectory, fileName),
			path.join(certificateOutputDirectory, fileName)
		);
		await chmod(path.join(certificateOutputDirectory, fileName), 0o644);
	}
	await copyFile(
		path.join(mkcertStoreDirectory, 'dev.pem'),
		path.join(certificateOutputDirectory, 'dev.pem')
	);
	await chmod(path.join(certificateOutputDirectory, 'dev.pem'), 0o600);
}

async function setupLocalHttps(): Promise<void> {
	const now = new Date();
	const rootCertificate = await readCertificate(path.join(mkcertStoreDirectory, 'rootCA.pem'));
	if (rootCertificate && certificateNeedsRenewal(rootCertificate.validTo, now)) {
		throw new Error(
			`The local mkcert root CA expires on ${rootCertificate.validTo}. Rotate it manually before continuing.`
		);
	}

	const serverCertificate = await readCertificate(path.join(mkcertStoreDirectory, 'cert.pem'));
	const forceRenewal = serverCertificate
		? certificateNeedsRenewal(serverCertificate.validTo, now)
		: false;

	await resolveConfig(
		{
			configFile: false,
			logLevel: 'warn',
			plugins: [
				mkcert({
					force: forceRenewal,
					hosts: certificateHosts,
					savePath: mkcertStoreDirectory
				})
			]
		},
		'serve',
		'development'
	);

	const mkcertBinary = path.join(
		mkcertStoreDirectory,
		process.platform === 'win32' ? 'mkcert.exe' : 'mkcert'
	);
	await execFileAsync(mkcertBinary, ['-install'], {
		env: { ...process.env, CAROOT: mkcertStoreDirectory }
	});
	await copyPublicRuntimeCertificates();

	const installedCertificate = await readCertificate(
		path.join(certificateOutputDirectory, 'cert.pem')
	);
	if (!installedCertificate) throw new Error('The local HTTPS certificate was not generated');
	for (const host of ['localhost', 'server']) {
		if (!installedCertificate.checkHost(host)) {
			throw new Error(`The local HTTPS certificate does not cover ${host}`);
		}
	}
	for (const address of ['127.0.0.1', '::1']) {
		if (!installedCertificate.checkIP(address)) {
			throw new Error(`The local HTTPS certificate does not cover ${address}`);
		}
	}

	console.info(
		`Local HTTPS is ready; certificate expires on ${installedCertificate.validTo} and will renew within ${renewalWindowDays} days of expiry.`
	);
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
	setupLocalHttps().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : 'Local HTTPS setup failed');
		process.exitCode = 1;
	});
}
