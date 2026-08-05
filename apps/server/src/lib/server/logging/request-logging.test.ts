import { describe, expect, it, vi } from 'vitest';
import { executeLoggedRequest, resolveRequestId } from './request-logging';

describe('request logging', () => {
	it('accepts a safe request id and replaces an unsafe one', () => {
		expect(resolveRequestId('desktop_01-request.2', () => 'generated-id')).toBe(
			'desktop_01-request.2'
		);
		expect(resolveRequestId('unsafe request\nheader', () => 'generated-id')).toBe('generated-id');
	});

	it('adds correlation context and logs a successful response', async () => {
		const debug = vi.fn();
		const logger = {
			child: vi.fn(() => ({ debug, info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
		};
		const setResponseHeader = vi.fn();

		const response = await executeLoggedRequest({
			incomingRequestId: 'request-123',
			logger,
			method: 'GET',
			now: vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(25),
			resolve: async ({ requestId, requestLogger }) => {
				expect(requestId).toBe('request-123');
				expect(requestLogger).toBeDefined();
				return new Response(null, { status: 204 });
			},
			routeId: '/api/trpc/[...trpc]',
			setResponseHeader
		});

		expect(response.status).toBe(204);
		expect(setResponseHeader).toHaveBeenCalledWith('x-request-id', 'request-123');
		expect(debug).toHaveBeenCalledWith(
			{
				durationMs: 15,
				event: 'http.request.completed',
				method: 'GET',
				routeId: '/api/trpc/[...trpc]',
				statusCode: 204
			},
			'HTTP request completed'
		);
	});

	it('uses warn for expected HTTP failures without logging URL data', async () => {
		const warn = vi.fn();
		const logger = {
			child: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() }))
		};

		await executeLoggedRequest({
			incomingRequestId: null,
			logger,
			method: 'POST',
			now: vi.fn().mockReturnValueOnce(5).mockReturnValueOnce(8),
			requestIdFactory: () => 'generated-id',
			resolve: async () => new Response(null, { status: 401 }),
			routeId: '/login',
			setResponseHeader: vi.fn()
		});

		expect(warn).toHaveBeenCalledWith(
			{
				durationMs: 3,
				event: 'http.request.completed',
				method: 'POST',
				routeId: '/login',
				statusCode: 401
			},
			'HTTP request completed'
		);
	});

	it('uses the Node performance clock without losing its receiver', async () => {
		const logger = {
			child: vi.fn(() => ({
				debug: vi.fn(),
				info: vi.fn(),
				warn: vi.fn(),
				error: vi.fn()
			}))
		};

		await expect(
			executeLoggedRequest({
				incomingRequestId: 'request-123',
				logger,
				method: 'GET',
				resolve: async () => new Response(null, { status: 204 }),
				routeId: '/health',
				setResponseHeader: vi.fn()
			})
		).resolves.toMatchObject({ status: 204 });
	});
});
