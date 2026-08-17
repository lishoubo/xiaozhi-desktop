import { describe, expect, it } from 'vitest';
import {
	archiveEntryIsForbidden,
	containsPrivateKeyMaterial,
	validateArchiveEntries,
	validateDeploymentArchiveEntries,
	validateProductionEnvironmentText
} from '../../../scripts/package-production-source.ts';

const prefix = 'hotel-butler/app/';
const requiredEntries = [
	`${prefix}.dockerignore`,
	`${prefix}package.json`,
	`${prefix}package-lock.json`,
	`${prefix}apps/server/Dockerfile`,
	`${prefix}apps/server/compose.production.yaml`,
	`${prefix}apps/server/scripts/start-production-https.mjs`,
	`${prefix}packages/api/package.json`
];

describe('production source archive policy', () => {
	it('accepts the required server build inputs and placeholder environment example', () => {
		expect(() =>
			validateArchiveEntries([
				...requiredEntries,
				`${prefix}apps/server/.env.production.example`,
				`${prefix}apps/server/src/app.html`
			])
		).not.toThrow();
	});

	it('rejects runtime environments, private material and generated dependencies', () => {
		for (const entry of [
			`${prefix}apps/server/.env`,
			`${prefix}apps/server/.env.production`,
			`${prefix}apps/server/.npmrc`,
			`${prefix}apps/server/key.pem`,
			`${prefix}apps/server/node_modules/package/index.js`
		]) {
			expect(archiveEntryIsForbidden(entry)).toBe(true);
		}
	});

	it('rejects an incomplete server build archive', () => {
		expect(() => validateArchiveEntries(requiredEntries.slice(1))).toThrow(
			'Deployment archive is missing required entries'
		);
	});

	it('accepts only the explicit production environment and server TLS runtime files', () => {
		expect(() =>
			validateDeploymentArchiveEntries([
				...requiredEntries,
				`${prefix}apps/server/.env.production`,
				'hotel-butler/tls/server/ca.pem',
				'hotel-butler/tls/server/cert.pem',
				'hotel-butler/tls/server/key.pem'
			])
		).not.toThrow();
		expect(() =>
			validateDeploymentArchiveEntries([
				...requiredEntries,
				`${prefix}apps/server/.env.production`,
				'hotel-butler/tls/server/ca.pem',
				'hotel-butler/tls/server/cert.pem',
				'hotel-butler/tls/server/key.pem',
				'hotel-butler/ca-key.pem'
			])
		).toThrow('Deployment bundle contains unexpected entries');
	});

	it('rejects placeholder or incomplete production environments', () => {
		const complete = [
			'POSTGRES_PASSWORD="generated"',
			'DATABASE_URL="postgres://configured"',
			'XIAOZHI_RMS_SERVER_URL="https://rms.example.invalid"',
			'BETTER_AUTH_SECRET="generated"',
			'AI_KIMI_API_KEY="generated"',
			'AI_DMS_DATABASE_ID="81918192"',
			'INITIAL_ADMIN_PASSWORD="generated"'
		].join('\n');
		expect(() => validateProductionEnvironmentText(complete)).not.toThrow();
		expect(() =>
			validateProductionEnvironmentText(
				complete.replace('https://rms.example.invalid', 'https://replace-with-rms-api-domain')
			)
		).toThrow('placeholder values');
		expect(() =>
			validateProductionEnvironmentText(complete.replace(/^AI_KIMI_API_KEY=.*$/m, ''))
		).toThrow('AI_KIMI_API_KEY');
		expect(() =>
			validateProductionEnvironmentText(complete.replace(/^AI_DMS_DATABASE_ID=.*$/m, ''))
		).toThrow('AI_DMS_DATABASE_ID');
		expect(() =>
			validateProductionEnvironmentText(
				complete.replace('https://rms.example.invalid', 'http://rms.example.invalid')
			)
		).toThrow('XIAOZHI_RMS_SERVER_URL must use HTTPS');
		expect(() =>
			validateProductionEnvironmentText(
				complete.replace('https://rms.example.invalid', 'http://rms.example.invalid'),
				{ allowInsecureRms: true }
			)
		).not.toThrow();
	});

	it('distinguishes real PEM private keys from scanner source text', () => {
		expect(containsPrivateKeyMaterial("Buffer.from('PRIVATE KEY-----')")).toBe(false);
		expect(
			containsPrivateKeyMaterial(`${['-----BEGIN', 'PRIVATE KEY-----'].join(' ')}\nsecret`)
		).toBe(true);
		expect(
			containsPrivateKeyMaterial(`${['-----BEGIN RSA', 'PRIVATE KEY-----'].join(' ')}\nsecret`)
		).toBe(true);
		expect(
			containsPrivateKeyMaterial(`${['-----BEGIN EC', 'PRIVATE KEY-----'].join(' ')}\nsecret`)
		).toBe(true);
	});
});
