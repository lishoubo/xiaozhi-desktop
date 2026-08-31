import { describe, expect, it, vi } from 'vitest';
import { createRmsApiCall } from '../../../src/main/gateway/rms/rms-api-call';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createCall(fetchImpl: typeof globalThis.fetch, reportError = vi.fn()) {
  const call = createRmsApiCall({
    origin: 'https://rms.example',
    fetch: fetchImpl,
    logger: createLogger(),
    subject: '酒店服务',
    reportError,
  });
  return { call, reportError };
}

describe('createRmsApiCall 的错误上报', () => {
  it('业务码非 0 时上报，并带上 operation 与 rmsCode', async () => {
    const { call, reportError } = createCall(() =>
      Promise.resolve(jsonResponse({ code: 40001, message: '该酒店未开通' })),
    );

    await expect(call('bindHotel', 'POST', '/hotel/bind')).rejects.toThrow('该酒店未开通');

    expect(reportError).toHaveBeenCalledTimes(1);
    const [error, context] = reportError.mock.calls[0];
    expect((error as Error).message).toBe('该酒店未开通');
    expect(context).toMatchObject({
      operation: 'bindHotel',
      extra: { rmsCode: 40001, reason: 'rejected' },
    });
  });

  it('响应不是 JSON 时上报 invalid-json', async () => {
    const { call, reportError } = createCall(() =>
      Promise.resolve(new Response('<html>502 Bad Gateway</html>', { status: 502 })),
    );

    await expect(call('listHotels', 'GET', '/hotel/list')).rejects.toThrow('酒店服务返回异常');

    expect(reportError.mock.calls[0][1]).toMatchObject({
      operation: 'listHotels',
      extra: { status: 502, reason: 'invalid-json' },
    });
  });

  /**
   * 成功路径不该产生任何上报 —— 否则 GlitchTip 会被正常流量淹掉，
   * 这正是「按 stack 聚合」也救不回来的那种噪声。
   */
  it('调用成功时不上报', async () => {
    const { call, reportError } = createCall(() =>
      Promise.resolve(jsonResponse({ code: 0, data: { id: 1 } })),
    );

    await expect(call('listHotels', 'GET', '/hotel/list')).resolves.toEqual({ id: 1 });
    expect(reportError).not.toHaveBeenCalled();
  });
});
