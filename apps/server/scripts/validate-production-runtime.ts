import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	validateProductionEnvironmentText,
	validateServerTlsMaterial
} from './package-production-source.ts';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const environmentPath = path.join(repositoryRoot, 'apps/server/.env.production');
const tlsDirectory = path.join(repositoryRoot, 'output/production-tls/121.199.29.74/server');

if (!existsSync(environmentPath) || !lstatSync(environmentPath).isFile()) {
	throw new Error(
		'Missing regular file apps/server/.env.production; generate and complete it first'
	);
}
if (lstatSync(environmentPath).isSymbolicLink()) {
	throw new Error('apps/server/.env.production must not be a symbolic link');
}
if ((lstatSync(environmentPath).mode & 0o077) !== 0) {
	throw new Error('.env.production permissions must not allow group or other access');
}

validateProductionEnvironmentText(readFileSync(environmentPath, 'utf8'));
validateServerTlsMaterial(tlsDirectory);
console.info('Production environment and TLS material are valid.');
