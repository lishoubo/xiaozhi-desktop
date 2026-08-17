import type { AppRouter } from '@hotel-butler/api';
import {
  createTRPCClient,
  httpLink,
  httpSubscriptionLink,
  splitLink,
  type TRPCClient,
} from '@trpc/client';
import { net, type Session } from 'electron';
import { EventSource } from 'eventsource';

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

export function createElectronSessionFetch(
  apiSession: Pick<Session, 'fetch'>,
): typeof globalThis.fetch {
  return (input, init) =>
    apiSession.fetch(input instanceof URL ? input.toString() : input, {
      ...init,
      credentials: 'include',
    });
}

export function createServerTrpcClient(options: ServerTrpcClientOptions): TRPCClient<AppRouter> {
  const fetchImplementation = options.fetch ?? electronNetFetch;

  return createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url: serverTrpcEndpoint(options.baseUrl),
        fetch: fetchImplementation,
      }),
    ],
  });
}

export function createServerTrpcStreamingClient(
  options: ServerTrpcClientOptions,
): TRPCClient<AppRouter> {
  const fetchImplementation = options.fetch ?? electronNetFetch;
  class AuthenticatedEventSource extends EventSource {
    constructor(url: string | URL, init?: EventSourceInit) {
      super(url, {
        ...init,
        fetch: (input, eventSourceInit) => fetchImplementation(input, eventSourceInit),
      });
    }
  }

  return createTRPCClient<AppRouter>({
    links: [
      splitLink({
        condition: (operation) => operation.type === 'subscription',
        true: httpSubscriptionLink({
          url: serverTrpcEndpoint(options.baseUrl),
          EventSource: AuthenticatedEventSource,
        }),
        false: httpLink({
          url: serverTrpcEndpoint(options.baseUrl),
          fetch: fetchImplementation,
        }),
      }),
    ],
  });
}
