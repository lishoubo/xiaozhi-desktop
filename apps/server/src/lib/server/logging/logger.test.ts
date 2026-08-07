import type { DestinationStream } from 'pino';
import { describe, expect, it } from 'vitest';
import {
	createServerLogger,
	resolveLogLevel,
	safeErrorDetails,
	safeErrorType
} from './logger';

describe('server logger', () => {
	it('redacts accidental credential and personal-data fields', () => {
		const records: string[] = [];
		const destination: DestinationStream = {
			write(message) {
				records.push(message);
			}
		};
		const logger = createServerLogger({ destination, level: 'info' });

		logger.info(
			{
				authorization: 'Bearer secret-token',
				cookie: 'session=secret-cookie',
				password: 'private-password',
				email: 'operator@example.com',
				phoneNumber: '13800138000',
				requestId: 'request-123'
			},
			'Redaction test'
		);

		const serialized = records.join('');
		expect(serialized).toContain('request-123');
		expect(serialized).toContain('[Redacted]');
		expect(serialized).not.toContain('secret-token');
		expect(serialized).not.toContain('secret-cookie');
		expect(serialized).not.toContain('private-password');
		expect(serialized).not.toContain('operator@example.com');
		expect(serialized).not.toContain('13800138000');
	});

	it('uses only supported configured levels', () => {
		expect(resolveLogLevel('trace', false)).toBe('trace');
		expect(resolveLogLevel('verbose', false)).toBe('info');
		expect(resolveLogLevel(undefined, true)).toBe('debug');
	});

	it('classifies errors without exposing their message', () => {
		expect(safeErrorType(new TypeError('password=secret'))).toBe('TypeError');
		expect(safeErrorType('password=secret')).toBe('UnknownError');
	});

	it('preserves stack frames while redacting sensitive values', () => {
		const error = new Error('cookie: session=private phone=13800138000 operator@example.com');
		error.stack =
			'Error: cookie: session=private phone=13800138000 operator@example.com\n    at loadSession (/app/session.ts:12:3)';

		const details = safeErrorDetails(error);

		expect(details.name).toBe('Error');
		expect(details.stack).toContain('at loadSession (/app/session.ts:12:3)');
		expect(JSON.stringify(details)).not.toContain('private');
		expect(JSON.stringify(details)).not.toContain('13800138000');
		expect(JSON.stringify(details)).not.toContain('operator@example.com');
	});
});
