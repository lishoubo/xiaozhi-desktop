import { describe, expect, it } from 'vitest';
import { resolveServerOrigin } from '../../../src/main/server/config';

describe('desktop server configuration', () => {
  it('uses the local HTTPS server by default', () => {
    expect(resolveServerOrigin({})).toBe('https://localhost:5173');
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
