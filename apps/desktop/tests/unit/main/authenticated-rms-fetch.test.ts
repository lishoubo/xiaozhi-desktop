import { describe, expect, it, vi } from 'vitest';
import { createAuthenticatedRmsFetch } from '../../../src/main/staff-auth/authenticated-rms-fetch';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function setup(responses: Response[]) {
  const queue = [...responses];
  const inner = vi.fn(async () => queue.shift() ?? jsonResponse({ code: 0, data: null }));
  const provider = {
    accessToken: vi.fn(async () => 'access-1'),
    invalidate: vi.fn(),
    adopt: vi.fn(),
    clear: vi.fn(),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const fetch = createAuthenticatedRmsFetch({
    fetch: inner as unknown as typeof globalThis.fetch,
    provider,
    logger,
  });
  return { fetch, inner, provider };
}

function headersOf(inner: ReturnType<typeof vi.fn>, call = 0): Headers {
  const init = inner.mock.calls[call]?.[1] as RequestInit;
  return new Headers(init.headers);
}

describe('createAuthenticatedRmsFetch', () => {
  it('injects the bearer token so gateways never touch it', async () => {
    const { fetch, inner } = setup([jsonResponse({ code: 0, data: [] })]);

    await fetch('http://localhost:8080/api/v1/app/hotels');

    expect(headersOf(inner).get('authorization')).toBe('Bearer access-1');
  });

  it('keeps the ASCII user-agent that the strict firewall requires', async () => {
    const { fetch, inner } = setup([jsonResponse({ code: 0, data: [] })]);

    await fetch('http://localhost:8080/api/v1/app/hotels');

    const userAgent = headersOf(inner).get('user-agent') ?? '';
    // eslint-disable-next-line no-control-regex -- 刻意匹配 ASCII 范围之外的字符。
    expect(userAgent).toMatch(/^[\x00-\x7F]+$/);
  });

  it('retries once with a fresh token when the server rejects the current one', async () => {
    const { fetch, inner, provider } = setup([
      jsonResponse({ code: 11004, message: 'token 已过期' }, 401),
      jsonResponse({ code: 0, data: [] }),
    ]);

    const response = await fetch('http://localhost:8080/api/v1/app/hotels');

    expect(inner).toHaveBeenCalledTimes(2);
    expect(provider.invalidate).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({ code: 0 });
  });

  it('does not retry forever when the refreshed token is rejected too', async () => {
    const { fetch, inner } = setup([
      jsonResponse({ code: 11004, message: 'token 已过期' }, 401),
      jsonResponse({ code: 11004, message: 'token 已过期' }, 401),
    ]);

    const response = await fetch('http://localhost:8080/api/v1/app/hotels');

    expect(inner).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(401);
  });

  it('actually sends a different token on the retry', async () => {
    // 光调 invalidate() 不够——若它只清内存缓存，盘上那份没过期的 token 会被
    // 原样读回来再发一次，重试必然又是 401。这里用真实 provider 语义验证：
    // invalidate 之后取到的必须是新值。
    let issued = 0;
    const provider = {
      accessToken: vi.fn(async () => `access-${++issued}`),
      invalidate: vi.fn(),
      adopt: vi.fn(),
      clear: vi.fn(),
    };
    const queue = [jsonResponse({ code: 11004 }, 401), jsonResponse({ code: 0, data: [] })];
    const inner = vi.fn(async () => queue.shift() ?? jsonResponse({ code: 0, data: null }));
    const fetch = createAuthenticatedRmsFetch({
      fetch: inner as unknown as typeof globalThis.fetch,
      provider,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await fetch('http://localhost:8080/api/v1/app/hotels');

    expect(headersOf(inner, 0).get('authorization')).toBe('Bearer access-1');
    expect(headersOf(inner, 1).get('authorization')).toBe('Bearer access-2');
  });

  it('passes business failures through untouched', async () => {
    // 403 不是认证问题，重试没有意义——原样交给调用方。
    const { fetch, inner } = setup([jsonResponse({ code: 10003, message: '无权限' }, 403)]);

    const response = await fetch('http://localhost:8080/api/v1/app/hotels');

    expect(inner).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(403);
  });
});
