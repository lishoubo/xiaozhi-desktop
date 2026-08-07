import { TRPCError } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';
import { logTrpcFailure } from './trpc-logging';

function createLogger() {
	return {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn()
	};
}

describe('tRPC failure logging', () => {
	it('logs expected client failures as warnings without raw error messages', () => {
		const logger = createLogger();
		const error = new TRPCError({
			code: 'BAD_REQUEST',
			message: 'email=operator@example.com'
		});

		logTrpcFailure(logger, { error, path: 'user.update', type: 'mutation' });

		expect(logger.warn).toHaveBeenCalledWith(
			{
				errorCode: 'BAD_REQUEST',
				errorType: 'TRPCError',
				event: 'trpc.procedure.failed',
				procedure: 'user.update',
				procedureType: 'mutation'
			},
			'tRPC procedure failed'
		);
		expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('operator@example.com');
	});

	it('logs unexpected server failures with a redacted cause stack', () => {
		const logger = createLogger();
		const cause = new TypeError('password=private phone=13800138000');
		cause.stack =
			'TypeError: password=private phone=13800138000\n    at queryEmployee (/app/employee.ts:42:7)';
		const error = new TRPCError({
			cause,
			code: 'INTERNAL_SERVER_ERROR'
		});

		logTrpcFailure(logger, { error, path: undefined, type: 'unknown' });

		expect(logger.error).toHaveBeenCalledWith(
			expect.objectContaining({
				error: {
					message: 'password=[Redacted] phone=[Redacted]',
					name: 'TypeError',
					stack: expect.stringContaining('at queryEmployee (/app/employee.ts:42:7)')
				},
				errorCode: 'INTERNAL_SERVER_ERROR',
				errorType: 'TypeError',
				procedure: 'unknown'
			}),
			'tRPC procedure failed'
		);
		expect(JSON.stringify(logger.error.mock.calls)).not.toContain('password=private');
		expect(JSON.stringify(logger.error.mock.calls)).not.toContain('13800138000');
	});
});
