import { describe, expect, it, vi } from 'vitest';
import { createRmsAuthClient } from '../../../src/main/staff-auth/rms-auth-client';

const ORIGIN = 'http://localhost:8080';

const TOKEN_PAIR = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  accessExpiresInSeconds: 28_800,
  refreshExpiresInSeconds: 604_800,
} as const;

function setup(response: unknown = { code: 0, message: 'ok', data: TOKEN_PAIR }) {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const fetch = vi.fn(async () => new Response(JSON.stringify(response)));
  const client = createRmsAuthClient({
    origin: ORIGIN,
    fetch: fetch as unknown as typeof globalThis.fetch,
    logger,
    now: vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(17),
    requestIdFactory: () => 'desktop-rms-auth-1',
  });
  return { client, fetch, logger };
}

function headersOf(fetch: ReturnType<typeof vi.fn>): Record<string, string> {
  const init = fetch.mock.calls[0]?.[1] as { headers: Record<string, string> };
  return init.headers;
}

describe('createRmsAuthClient user-agent', () => {
  // rms-server 的 StrictHttpFirewall 只接受 ASCII header 值，而 Electron 默认 UA
  // 里带着中文应用名（"小智酒店管家"），会让请求在进 controller 之前就被拒。
  it('sends an ASCII-only user-agent on login', async () => {
    const { client, fetch } = setup();

    await client.login('staff-1', 'secret');

    // eslint-disable-next-line no-control-regex -- 刻意匹配 ASCII 范围之外的字符。
    expect(headersOf(fetch)['user-agent']).toMatch(/^[\x00-\x7F]+$/);
  });

  it('logs a safe start and completion for the remote call', async () => {
    const { client, logger } = setup();

    await client.login('staff-1', 'secret-password');

    const serialized = JSON.stringify(logger.info.mock.calls);
    expect(serialized).toContain('rms.http.request.started');
    expect(serialized).toContain('rms.http.request.completed');
    expect(serialized).toContain('desktop-rms-auth-1');
    expect(serialized).toContain('"durationMs":7');
    expect(serialized).not.toContain('staff-1');
    expect(serialized).not.toContain('secret-password');
  });

  it('sends an ASCII-only user-agent on every authenticated call', async () => {
    const { client, fetch } = setup({ code: 0, message: 'ok', data: undefined });

    await client.logout('access-1');

    // eslint-disable-next-line no-control-regex -- 刻意匹配 ASCII 范围之外的字符。
    expect(headersOf(fetch)['user-agent']).toMatch(/^[\x00-\x7F]+$/);
    expect(headersOf(fetch).authorization).toBe('Bearer access-1');
  });
});
