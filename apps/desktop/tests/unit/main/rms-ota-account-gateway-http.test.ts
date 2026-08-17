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
      bindExtra: { channelAccountId: 'acc-1', channelAccountName: '云朵酒店' },
    });

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`${ORIGIN}/api/v1/app/ota-accounts/20`);
    expect(init?.method).toBe('PUT');
    // 重新登录只换凭证，不该把门店关系一起送过去。
    const body = JSON.parse(String(init?.body));
    expect(body).not.toHaveProperty('hotelId');
    expect(body).not.toHaveProperty('otaHotelId');
    // 只发账号级字段。门店级的（merchantGroupId / otaPartnerId）在类型上就传不进来：
    // 同一账号下每家门店取值可能不同，这个调用没确认门店，写进去会让 RPA 拿错参数。
    expect(body.bindExtra).toEqual({ channelAccountId: 'acc-1', channelAccountName: '云朵酒店' });
  });

  /**
   * 修复没有门店的绑定：同一个 PUT 端点，多送 otaHotelId / otaHotelName。
   * 不能走 POST——远端按「酒店+渠道」占位，这条记录本身就占着位，一定被拒。
   */
  it('backfills the hotel through the same PUT endpoint', async () => {
    const { gateway, fetch } = setup({
      code: 0,
      data: { id: 20, hotelId: 2, status: 'BOUND', source: 'ctrip' },
    });

    await gateway.backfillHotel({
      operationId: 'op-3',
      otaAccountId: 20,
      otaHotelId: '105500259',
      otaHotelName: 'Alan·银际酒店(九原区政府店)',
      cookies: [{ domain: '.ctrip.com', name: 'sid', value: 'v3' }],
      bindExtra: { channelAccountId: 'acc-1', merchantGroupId: 'group-1' },
    });

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`${ORIGIN}/api/v1/app/ota-accounts/20`);
    expect(init?.method).toBe('PUT');
    const body = JSON.parse(String(init?.body));
    // 两字段成对送达——远端只传其一会 400，这里类型上就是必填。
    expect(body.otaHotelId).toBe('105500259');
    expect(body.otaHotelName).toBe('Alan·银际酒店(九原区政府店)');
    // 门店由用户当场确认，所以门店级字段在这条路上可信、要一并写。
    expect(body.bindExtra).toEqual({ channelAccountId: 'acc-1', merchantGroupId: 'group-1' });
  });

  it('omits bindExtra when reauthenticating without any bind context', async () => {
    // 传 null 会覆盖远端已有值，而这里的语义是"不改动"。
    const { gateway, fetch } = setup({
      code: 0,
      data: { id: 20, hotelId: 2, status: 'BOUND', source: 'douyin' },
    });

    await gateway.reauthenticate({
      operationId: 'op-3',
      otaAccountId: 20,
      cookies: [{ domain: '.douyin.com', name: 'sid', value: 'v2' }],
      bindExtra: null,
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
