import { appRouter, type ApiContext } from '@hotel-butler/api';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import type { RequestHandler } from './$types';

const endpoint = '/api/trpc';

const handleTrpcRequest: RequestHandler = ({ request }) =>
	fetchRequestHandler({
		endpoint,
		req: request,
		router: appRouter,
		createContext: (): ApiContext => ({})
	});

export const GET = handleTrpcRequest;
export const POST = handleTrpcRequest;
