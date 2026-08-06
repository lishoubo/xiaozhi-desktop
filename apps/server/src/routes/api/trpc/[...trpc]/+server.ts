import { appRouter, type ApiContext } from '@hotel-butler/api';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { rmsClient } from '$lib/server/db/rms';
import { createEmployeeIdentityDirectory } from '$lib/server/employee-identity-directory';
import { logTrpcFailure } from '$lib/server/logging/trpc-logging';
import type { RequestHandler } from './$types';

const endpoint = '/api/trpc';
const employeeDirectory = createEmployeeIdentityDirectory({
	execute: (sql, values) => rmsClient.execute(sql, values)
});

const handleTrpcRequest: RequestHandler = ({ locals, request }) =>
	fetchRequestHandler({
		endpoint,
		req: request,
		router: appRouter,
		createContext: (): ApiContext => ({
			employeeDirectory,
			logger: locals.logger,
			requestId: locals.requestId
		}),
		onError: ({ error, path, type }) =>
			logTrpcFailure(locals.logger, { error, path, type: type ?? 'unknown' })
	});

export const GET = handleTrpcRequest;
export const POST = handleTrpcRequest;
