import { net } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createServerTrpcClient,
  electronNetFetch,
  serverTrpcEndpoint,
} from '../../../src/main/server/trpc-client';

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
      new Response(JSON.stringify({ result: { data: { status: 'ok' } } }), {
        headers: { 'content-type': 'application/json' },
      }),
    );

    const client = createServerTrpcClient({ baseUrl: 'https://localhost:4173' });

    await expect(client.system.health.query()).resolves.toEqual({ status: 'ok' });
    expect(net.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/localhost:4173\/api\/trpc\/system\.health/),
      expect.objectContaining({ method: 'GET' }),
    );
    expect(electronNetFetch).toBeTypeOf('function');
  });
});
