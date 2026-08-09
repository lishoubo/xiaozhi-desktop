import { describe, expect, it, vi } from 'vitest';
import { HttpRmsOtaAccountGateway } from '../../../src/main/gateway/rms/rms-ota-account-gateway-http';
import { toChannelId } from '../../../src/main/ids';

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
  const gateway = new HttpRmsOtaAccountGateway({
    origin: ORIGIN,
    fetch: fetch as unknown as typeof globalThis.fetch,
    logger,
  });
  return { gateway, fetch };
}

const BIND_INPUT = {
  operationId: 'op-1',
  hotelId: 2,
  source: toChannelId('douyin'),
  otaHotelId: 'poi-1',
  otaHotelName: '测试门店',
  bindExtra: { channelAccountId: 'acc-1' },
  cookies: [{ domain: '.douyin.com', name: 'sid', value: 'v1' }],
} as const;

describe('HttpRmsOtaAccountGateway', () => {
  it('maps a fully populated binding onto RmsOtaAccount', async () => {
    const { gateway } = setup({
      code: 0,
      data: [
        {
          id: 11,
          hotelId: 2,
          otaHotelId: '762662011',
          otaHotelName: '璞禾咖啡酒店（禧瑞都店）',
          status: 'BOUND',
          source: 'meituan',
          bindExtra: { otaPartnerId: '4595635' },
        },
      ],
    });

    const accounts = await gateway.listOtaAccounts();

    expect(accounts).toEqual([
      {
        id: 11,
        hotelId: 2,
        otaHotelId: '762662011',
        otaHotelName: '璞禾咖啡酒店（禧瑞都店）',
        status: 'BOUND',
        source: 'meituan',
        bindExtra: { otaPartnerId: '4595635' },
      },
    ]);
  });

  it('normalises omitted optional fields to null', async () => {
    // 远端对未初始化的绑定整个省略这些键，而不是给 null——desktop 的类型要求 null。
    const { gateway } = setup({
      code: 0,
      data: [{ id: 7, hotelId: 3, status: 'LOGIN_FAILED', source: 'ctrip' }],
    });

    const [account] = await gateway.listOtaAccounts();

    expect(account.otaHotelId).toBeNull();
    expect(account.otaHotelName).toBeNull();
    expect(account.bindExtra).toBeNull();
  });

  it('posts the bind payload with the cookie snapshot', async () => {
    const { gateway, fetch } = setup({
      code: 0,
      data: { id: 20, hotelId: 2, status: 'BOUND', source: 'douyin' },
    });

    await gateway.bind(BIND_INPUT);

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`${ORIGIN}/api/v1/app/ota-accounts`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      hotelId: 2,
      source: 'douyin',
      otaHotelId: 'poi-1',
      cookies: [{ domain: '.douyin.com', name: 'sid', value: 'v1' }],
    });
  });

  it('reauthenticates through PUT on the account id', async () => {
    const { gateway, fetch } = setup({
      code: 0,
      data: { id: 20, hotelId: 2, status: 'BOUND', source: 'douyin' },
    });

    await gateway.reauthenticate({
      operationId: 'op-2',
      otaAccountId: 20,
      cookies: [{ domain: '.douyin.com', name: 'sid', value: 'v2' }],
      channelAccountId: 'acc-1',
    });

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`${ORIGIN}/api/v1/app/ota-accounts/20`);
    expect(init?.method).toBe('PUT');
    // 重新登录只换凭证，不该把门店关系一起送过去。
    const body = JSON.parse(String(init?.body));
    expect(body).not.toHaveProperty('hotelId');
    expect(body).not.toHaveProperty('otaHotelId');
    expect(body.bindExtra).toMatchObject({ channelAccountId: 'acc-1' });
  });

  it('omits bindExtra when reauthenticating without a channel account id', async () => {
    // 传 null 会覆盖远端已有值，而这里的语义是"不改动"。
    const { gateway, fetch } = setup({
      code: 0,
      data: { id: 20, hotelId: 2, status: 'BOUND', source: 'douyin' },
    });

    await gateway.reauthenticate({
      operationId: 'op-3',
      otaAccountId: 20,
      cookies: [{ domain: '.douyin.com', name: 'sid', value: 'v2' }],
      channelAccountId: null,
    });

    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(body).not.toHaveProperty('bindExtra');
  });

  it('unbinds through DELETE on the account id', async () => {
    const { gateway, fetch } = setup({ code: 0 });

    await gateway.unbind(20);

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`${ORIGIN}/api/v1/app/ota-accounts/20`);
    expect(init?.method).toBe('DELETE');
  });

  it('surfaces the remote message when the business code is not zero', async () => {
    const { gateway } = setup({ code: 20005, message: '该酒店已绑定该渠道' }, 409);

    await expect(gateway.bind(BIND_INPUT)).rejects.toThrow('该酒店已绑定该渠道');
  });
});
