import { describe, expect, it } from 'vitest';
import { serverTrpcEndpoint } from '../../../src/main/server/trpc-client';

describe('serverTrpcEndpoint', () => {
  it('builds the shared tRPC endpoint from the configured server origin', () => {
    expect(serverTrpcEndpoint('https://rms.example.com/')).toBe('https://rms.example.com/api/trpc');
  });

  it('rejects non-web protocols', () => {
    expect(() => serverTrpcEndpoint('file:///tmp/server')).toThrow(
      'The server URL must use HTTP or HTTPS',
    );
  });
});
