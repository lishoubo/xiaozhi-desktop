import type { TRPCError } from '@trpc/server';
import { safeErrorDetails, safeErrorType } from './logger';
import type { RequestLogger } from './request-logging';

interface TrpcFailure {
	error: TRPCError;
	path: string | undefined;
	type: 'query' | 'mutation' | 'subscription' | 'unknown';
}

export function logTrpcFailure(logger: RequestLogger, { error, path, type }: TrpcFailure): void {
	const fields = {
		errorCode: error.code,
		errorType: safeErrorType(error.cause ?? error),
		event: 'trpc.procedure.failed',
		procedure: path ?? 'unknown',
		procedureType: type
	};

	if (error.code === 'INTERNAL_SERVER_ERROR') {
		logger.error(
			{ ...fields, error: safeErrorDetails(error.cause ?? error) },
			'tRPC procedure failed'
		);
	} else {
		logger.warn(fields, 'tRPC procedure failed');
	}
}
