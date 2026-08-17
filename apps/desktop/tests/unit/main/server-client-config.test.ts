import { describe, expect, it } from 'vitest';
import { resolveServerOrigin } from '../../../src/main/server-client/config';
import { resolveServerOriginForBuild } from '../../../vite-plugins/server-origin';

describe('desktop server configuration', () => {
  it('uses the local HTTPS server by default', () => {
    expect(resolveServerOrigin({})).toBe(__SERVER_ORIGIN__);
  });

  it('normalizes an explicitly configured HTTPS URL to its origin', () => {
    expect(
      resolveServerOrigin({ HOTEL_BUTLER_SERVER_URL: 'https://api.example.com/base?ignored=true' }),
    ).toBe('https://api.example.com');
  });

  it('rejects non-HTTPS server URLs', () => {
    expect(() =>
      resolveServerOrigin({ HOTEL_BUTLER_SERVER_URL: 'http://api.example.com' }),
    ).toThrow('Desktop server URL must use HTTPS');
  });
});

describe('desktop server build configuration', () => {
  it('embeds a normalized HTTPS production origin', () => {
    expect(
      resolveServerOriginForBuild({
        HOTEL_BUTLER_SERVER_URL: 'https://10.0.0.8:3443/base?ignored=true',
      }),
    ).toBe('https://10.0.0.8:3443');
  });

  it('rejects an HTTP production origin', () => {
    expect(() =>
      resolveServerOriginForBuild({ HOTEL_BUTLER_SERVER_URL: 'http://10.0.0.8' }),
    ).toThrow('HOTEL_BUTLER_SERVER_URL must use HTTPS');
  });
});
