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

	it('logs unexpected server failures as errors using only the cause type', () => {
		const logger = createLogger();
		const error = new TRPCError({
			cause: new TypeError('password=private'),
			code: 'INTERNAL_SERVER_ERROR'
		});

		logTrpcFailure(logger, { error, path: undefined, type: 'unknown' });

		expect(logger.error).toHaveBeenCalledWith(
			expect.objectContaining({
				errorCode: 'INTERNAL_SERVER_ERROR',
				errorType: 'TypeError',
				procedure: 'unknown'
			}),
			'tRPC procedure failed'
		);
		expect(JSON.stringify(logger.error.mock.calls)).not.toContain('password=private');
	});
});
