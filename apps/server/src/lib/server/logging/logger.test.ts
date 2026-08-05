import type { DestinationStream } from 'pino';
import { describe, expect, it } from 'vitest';
import { createServerLogger, resolveLogLevel, safeErrorType } from './logger';

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
});
