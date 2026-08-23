import { createHash } from 'node:crypto';
import type { EmployeeIdentity } from '@hotel-butler/api';
import type { DesktopSessionGateway, EmployeeIdentityDirectory } from './desktop-api-endpoint';

export const DESKTOP_SESSION_COOKIE_NAME = '__Host-xiaozhi_desktop_session';
export const DESKTOP_SESSION_DURATION_SECONDS = 7 * 24 * 60 * 60;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type DesktopSessionRecord = Readonly<{
	employeeId: string;
	expiresAt: Date;
	tokenDigest: string;
}>;

export type DesktopSessionCreate = DesktopSessionRecord &
	Readonly<{
		id: string;
		createdAt: Date;
	}>;

export interface DesktopSessionRepository {
	create(session: DesktopSessionCreate): Promise<void>;
	deleteByTokenDigest(tokenDigest: string): Promise<void>;
	findByTokenDigest(tokenDigest: string): Promise<DesktopSessionRecord | null>;
}

type DesktopSessionDependencies = Readonly<{
	employeeDirectory: EmployeeIdentityDirectory;
	generateId: () => string;
	generateToken: () => string;
	now: () => Date;
	repository: DesktopSessionRepository;
	requestHeaders: Headers;
	responseHeaders: Headers;
}>;

function digest(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

function readCookie(headers: Headers): string | null | undefined {
	const cookieHeader = headers.get('cookie');
	if (!cookieHeader) return undefined;
	for (const part of cookieHeader.split(';')) {
		const separator = part.indexOf('=');
		if (separator < 0) continue;
		const name = part.slice(0, separator).trim();
		if (name !== DESKTOP_SESSION_COOKIE_NAME) continue;
		const value = part.slice(separator + 1).trim();
		return TOKEN_PATTERN.test(value) ? value : null;
	}
	return undefined;
}

function sessionCookie(token: string, expiresAt: Date): string {
	return [
		`${DESKTOP_SESSION_COOKIE_NAME}=${token}`,
		'Path=/',
		'HttpOnly',
		'Secure',
		'SameSite=Strict',
		`Max-Age=${DESKTOP_SESSION_DURATION_SECONDS}`,
		`Expires=${expiresAt.toUTCString()}`
	].join('; ');
}

function expiredSessionCookie(): string {
	return [
		`${DESKTOP_SESSION_COOKIE_NAME}=`,
		'Path=/',
		'HttpOnly',
		'Secure',
		'SameSite=Strict',
		'Max-Age=0',
		'Expires=Thu, 01 Jan 1970 00:00:00 GMT'
	].join('; ');
}

export function createDesktopSessionGateway(
	dependencies: DesktopSessionDependencies
): DesktopSessionGateway {
	const { employeeDirectory, repository, requestHeaders, responseHeaders } = dependencies;

	const clearCookie = (): void => responseHeaders.append('set-cookie', expiredSessionCookie());

	return {
		issue: async (employee: EmployeeIdentity) => {
			const createdAt = dependencies.now();
			const expiresAt = new Date(createdAt.getTime() + DESKTOP_SESSION_DURATION_SECONDS * 1000);
			const token = dependencies.generateToken();
			if (!TOKEN_PATTERN.test(token)) throw new Error('Desktop session token generator failed');
			await repository.create({
				id: dependencies.generateId(),
				employeeId: employee.id,
				tokenDigest: digest(token),
				createdAt,
				expiresAt
			});
			responseHeaders.append('set-cookie', sessionCookie(token, expiresAt));
		},
		currentEmployee: async () => {
			const token = readCookie(requestHeaders);
			if (token === undefined) return null;
			if (token === null) {
				clearCookie();
				return null;
			}
			const tokenDigest = digest(token);
			const record = await repository.findByTokenDigest(tokenDigest);
			if (!record) {
				clearCookie();
				return null;
			}
			if (record.expiresAt.getTime() <= dependencies.now().getTime()) {
				await repository.deleteByTokenDigest(tokenDigest);
				clearCookie();
				return null;
			}
			const employee = await employeeDirectory.findActiveById(record.employeeId);
			if (!employee) {
				await repository.deleteByTokenDigest(tokenDigest);
				clearCookie();
				return null;
			}
			return employee;
		},
		revoke: async () => {
			const token = readCookie(requestHeaders);
			if (token) await repository.deleteByTokenDigest(digest(token));
			clearCookie();
		}
	};
}
