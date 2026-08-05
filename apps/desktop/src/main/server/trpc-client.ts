import type { AppRouter } from '@hotel-butler/api';
import { createTRPCClient, httpLink, type TRPCClient } from '@trpc/client';
import { net } from 'electron';

export interface ServerTrpcClientOptions {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
}

export function serverTrpcEndpoint(baseUrl: string): string {
  const url = new URL(baseUrl);

  if (url.protocol !== 'https:') {
    throw new Error('The server URL must use HTTPS');
  }

  url.pathname = `${url.pathname.replace(/\/$/, '')}/api/trpc`;
  url.search = '';
  url.hash = '';

  return url.toString();
}

export const electronNetFetch: typeof globalThis.fetch = (input, init) =>
  net.fetch(input instanceof URL ? input.toString() : input, init);

export function createServerTrpcClient(options: ServerTrpcClientOptions): TRPCClient<AppRouter> {
  return createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url: serverTrpcEndpoint(options.baseUrl),
        fetch: options.fetch ?? electronNetFetch,
      }),
    ],
  });
}
