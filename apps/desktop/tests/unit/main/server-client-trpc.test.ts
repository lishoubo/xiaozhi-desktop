import { net } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createElectronSessionFetch,
  createServerTrpcClient,
  electronNetFetch,
  serverTrpcEndpoint,
} from '../../../src/main/server-client/trpc-client';

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }));

beforeEach(() => {
  vi.mocked(net.fetch).mockReset();
});

describe('serverTrpcEndpoint', () => {
  it('builds the shared tRPC endpoint from the configured server origin', () => {
    expect(serverTrpcEndpoint('https://rms.example.com/')).toBe('https://rms.example.com/api/trpc');
  });

  it('rejects an insecure HTTP server URL', () => {
    expect(() => serverTrpcEndpoint('http://localhost:5173')).toThrow(
      'The server URL must use HTTPS',
    );
  });

  it('rejects other non-HTTPS protocols', () => {
    expect(() => serverTrpcEndpoint('file:///tmp/server')).toThrow('The server URL must use HTTPS');
  });

  it('uses the Electron network stack by default', async () => {
    vi.mocked(net.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          result: {
            data: {
              status: 'ok',
              authentication: {
                staff: true,
                phone: true,
                phoneIdentitySourceConfigured: false,
              },
            },
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    );

    const client = createServerTrpcClient({ baseUrl: 'https://localhost:4173' });

    await expect(client.system.health.query()).resolves.toEqual({
      status: 'ok',
      authentication: {
        staff: true,
        phone: true,
        phoneIdentitySourceConfigured: false,
      },
    });
    expect(net.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/localhost:4173\/api\/trpc\/system\.health/),
      expect.objectContaining({ method: 'GET' }),
    );
    expect(electronNetFetch).toBeTypeOf('function');
  });

  it('includes the dedicated Electron session cookie jar on every request', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const sessionFetch = createElectronSessionFetch({ fetch });

    await sessionFetch('https://rms.example.com/api/trpc/auth.currentSession', {
      method: 'GET',
      credentials: 'omit',
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://rms.example.com/api/trpc/auth.currentSession',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });
});
