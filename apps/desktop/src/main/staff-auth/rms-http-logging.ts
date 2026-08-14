import type { AppLogger } from '../../shared/logging';

type LoggedRmsFetchOptions = Readonly<{
  attempt: number;
  fetch: typeof globalThis.fetch;
  init?: RequestInit;
  input: RequestInfo | URL;
  logger: AppLogger;
  now: () => number;
  operation: string;
  requestId: string;
}>;

function endpointFields(input: RequestInfo | URL): Readonly<{
  endpointOrigin: string;
  endpointPath: string;
}> {
  const value =
    input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
  return { endpointOrigin: value.origin, endpointPath: value.pathname };
}

function requestMethod(input: RequestInfo | URL, init: RequestInit | undefined): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof input !== 'string' && !(input instanceof URL)) return input.method.toUpperCase();
  return 'GET';
}

export async function executeLoggedRmsFetch(options: LoggedRmsFetchOptions): Promise<Response> {
  const { attempt, fetch, init, input, logger, now, operation, requestId } = options;
  const startedAt = now();
  const context = {
    ...endpointFields(input),
    attempt,
    externalService: 'rms',
    method: requestMethod(input, init),
    operation,
    requestId,
  };
  logger.info('RMS HTTP request started', { ...context, event: 'rms.http.request.started' });

  try {
    const response = await fetch(input, init);
    const fields = {
      ...context,
      durationMs: Math.max(0, Math.round(now() - startedAt)),
      event: 'rms.http.request.completed',
      status: response.status,
    };
    if (response.ok) logger.info('RMS HTTP request completed', fields);
    else logger.warn('RMS HTTP request completed', fields);
    return response;
  } catch (error) {
    logger.error('RMS HTTP request failed', {
      ...context,
      durationMs: Math.max(0, Math.round(now() - startedAt)),
      errorName: error instanceof Error ? error.name : 'UnknownError',
      event: 'rms.http.request.failed',
    });
    throw error;
  }
}
