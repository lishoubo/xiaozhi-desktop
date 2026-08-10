import type { AppLogger } from '../../shared/logging';
import type { RmsTokenProvider } from '../staff-auth/rms-token-provider';

export function createStaffServerFetch(
  fetchImplementation: typeof globalThis.fetch,
  tokens: RmsTokenProvider,
  logger: AppLogger,
): typeof globalThis.fetch {
  const send = async (
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    token: string,
  ): Promise<Response> => {
    const headers = new Headers(init?.headers);
    headers.set('authorization', `Bearer ${token}`);
    return fetchImplementation(input, { ...init, headers });
  };

  return async (input, init) => {
    const response = await send(input, init, await tokens.accessToken());
    if (response.status !== 401) return response;
    logger.warn('Agent backend rejected the staff token; refreshing once');
    tokens.invalidate();
    return send(input, init, await tokens.accessToken());
  };
}
