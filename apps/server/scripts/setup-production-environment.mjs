import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const templatePath = path.join(serverDirectory, '.env.production.example');
const environmentPath = path.join(serverDirectory, '.env.production');
const databasePort = '35432';
const serverOrigin = 'https://121.199.29.74:35443';

function replaceSetting(source, name, value) {
	const pattern = new RegExp(`^${name}=.*$`, 'm');
	if (!pattern.test(source)) throw new Error(`Production template is missing ${name}`);
	return source.replace(pattern, `${name}="${value}"`);
}

function writeEnvironment(environment) {
	writeFileSync(environmentPath, environment, { encoding: 'utf8', mode: 0o600 });
	chmodSync(environmentPath, 0o600);
}

function ensureRmsServerPlaceholder(environment) {
	if (/^XIAOZHI_RMS_SERVER_URL=/m.test(environment)) return environment;
	const commented = /^#\s*XIAOZHI_RMS_SERVER_URL=.*$/m;
	if (commented.test(environment)) {
		return environment.replace(
			commented,
			'XIAOZHI_RMS_SERVER_URL="https://replace-with-rms-api-domain"'
		);
	}
	return `${environment.trimEnd()}\nXIAOZHI_RMS_SERVER_URL="https://replace-with-rms-api-domain"\n`;
}

if (process.argv[2] === '--rotate-db-password') {
	if (!existsSync(environmentPath)) {
		throw new Error(`Production environment does not exist: ${environmentPath}`);
	}
	const databasePassword = randomBytes(32).toString('hex');
	let existing = ensureRmsServerPlaceholder(readFileSync(environmentPath, 'utf8'));
	const databaseUrlMatch = existing.match(/^DATABASE_URL="([^"]+)"$/m);
	if (!databaseUrlMatch) throw new Error('DATABASE_URL is missing or malformed');
	const databaseUrl = new URL(databaseUrlMatch[1]);
	if (databaseUrl.protocol !== 'postgres:' || databaseUrl.hostname !== 'db') {
		throw new Error('DATABASE_URL must target the Compose database host');
	}
	databaseUrl.password = databasePassword;
	existing = replaceSetting(existing, 'POSTGRES_PASSWORD', databasePassword);
	existing = replaceSetting(existing, 'DATABASE_URL', databaseUrl.toString());
	writeEnvironment(existing);
	console.info('Production database password rotated in the ignored environment file.');
	process.exit(0);
}

if (process.argv[2] === '--sync-ports') {
	if (!existsSync(environmentPath)) {
		throw new Error(`Production environment does not exist: ${environmentPath}`);
	}
	let existing = ensureRmsServerPlaceholder(readFileSync(environmentPath, 'utf8'));
	if (!/^POSTGRES_PORT=/m.test(existing)) {
		existing = existing.replace(/^(POSTGRES_DATA_DIR=.*)$/m, `$1\nPOSTGRES_PORT="${databasePort}"`);
	} else {
		existing = replaceSetting(existing, 'POSTGRES_PORT', databasePort);
	}
	if (!/^POSTGRES_BIND_ADDRESS=/m.test(existing)) {
		existing = existing.replace(/^(POSTGRES_DATA_DIR=.*)$/m, '$1\nPOSTGRES_BIND_ADDRESS="0.0.0.0"');
	} else {
		existing = replaceSetting(existing, 'POSTGRES_BIND_ADDRESS', '0.0.0.0');
	}
	if (!/@db:\d+\//.test(existing)) {
		throw new Error('DATABASE_URL must target the Compose database host with an explicit port');
	}
	existing = existing.replace(/@db:\d+\//, `@db:${databasePort}/`);
	existing = replaceSetting(existing, 'ORIGIN', serverOrigin);
	existing = replaceSetting(existing, 'SERVER_HTTPS_PORT', '35443');
	writeEnvironment(existing);
	console.info(`Production ports synchronized in ${environmentPath}`);
	console.info(
		`PostgreSQL internal port: ${databasePort}; public server endpoint: ${serverOrigin}`
	);
	process.exit(0);
}
if (process.argv.length > 2) {
	throw new Error('Supported arguments: --sync-ports | --rotate-db-password');
}
if (existsSync(environmentPath)) {
	throw new Error(`Refusing to overwrite existing production environment: ${environmentPath}`);
}

const databaseUser = 'hotel_butler_app';
const databaseName = 'hotel_butler';
const databasePassword = randomBytes(32).toString('hex');
let environment = readFileSync(templatePath, 'utf8');
environment = replaceSetting(environment, 'POSTGRES_USER', databaseUser);
environment = replaceSetting(environment, 'POSTGRES_PASSWORD', databasePassword);
environment = replaceSetting(environment, 'POSTGRES_DB', databaseName);
environment = replaceSetting(environment, 'POSTGRES_BIND_ADDRESS', '0.0.0.0');
environment = replaceSetting(environment, 'POSTGRES_PORT', databasePort);
environment = replaceSetting(
	environment,
	'DATABASE_URL',
	`postgres://${databaseUser}:${databasePassword}@db:${databasePort}/${databaseName}`
);
writeFileSync(environmentPath, environment, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
chmodSync(environmentPath, 0o600);

console.info(`Production environment created at ${environmentPath}`);
console.info(
	`PostgreSQL account: ${databaseUser}; database: ${databaseName}; internal port: ${databasePort}`
);
console.info('The generated database password was written only to the ignored environment file.');
console.info(`Public server endpoint: ${serverOrigin}`);
