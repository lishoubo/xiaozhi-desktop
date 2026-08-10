import { describe, expect, it, vi } from 'vitest';
import { HttpRmsHotelGateway } from '../../../src/main/gateway/rms/rms-hotel-gateway-http';

const ORIGIN = 'http://localhost:8080';

function setup(payload: unknown, status = 200) {
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const gateway = new HttpRmsHotelGateway({
    origin: ORIGIN,
    fetch: fetch as unknown as typeof globalThis.fetch,
    logger,
  });
  return { gateway, fetch };
}

describe('HttpRmsHotelGateway', () => {
  it('maps the AppHotelResponse list onto RmsHotel', async () => {
    const { gateway, fetch } = setup({
      code: 0,
      message: 'OK',
      data: [{ id: 1003, name: '苏州平江府', status: 1 }],
    });

    const hotels = await gateway.listHotels();

    expect(hotels).toEqual([{ id: 1003, name: '苏州平江府', status: 1 }]);
    expect(fetch).toHaveBeenCalledWith(`${ORIGIN}/api/v1/app/hotels`, expect.anything());
  });

  it('sends no authorization header of its own — the fetch it is given already carries one', async () => {
    const { gateway, fetch } = setup({ code: 0, data: [] });

    await gateway.listHotels();

    const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers ?? {});
    expect(headers.has('authorization')).toBe(false);
  });

  it('surfaces the remote message when the business code is not zero', async () => {
    const { gateway } = setup({ code: 10003, message: '当前员工无所属组织，无法创建酒店' }, 403);

    await expect(gateway.createHotel({ name: '测试酒店' })).rejects.toThrow(
      '当前员工无所属组织，无法创建酒店',
    );
  });

  it('rejects a payload that does not match the envelope', async () => {
    // Spring 默认错误页或反向代理插进来的响应，形状对不上契约。
    const { gateway } = setup({ timestamp: '2026-08-09', error: 'Not Found' }, 404);

    await expect(gateway.listHotels()).rejects.toThrow('酒店服务返回异常，请稍后重试');
  });
});
