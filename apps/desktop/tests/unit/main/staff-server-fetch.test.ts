import { describe, expect, it, vi } from 'vitest';
import { createStaffServerFetch } from '../../../src/main/server-client/staff-server-fetch';

describe('createStaffServerFetch', () => {
  it('injects the current staff token and refreshes once after a 401', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const accessToken = vi.fn().mockResolvedValueOnce('token-a').mockResolvedValueOnce('token-b');
    const invalidate = vi.fn();
    const authenticatedFetch = createStaffServerFetch(
      fetch,
      {
        accessToken,
        invalidate,
        adopt: vi.fn(),
        clear: vi.fn(),
      },
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    );

    await expect(authenticatedFetch('https://server.example/api/trpc')).resolves.toHaveProperty(
      'status',
      200,
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
      'Bearer token-a',
    );
    expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).get('authorization')).toBe(
      'Bearer token-b',
    );
    expect(invalidate).toHaveBeenCalledOnce();
  });
});
