import { describe, expect, it, vi } from 'vitest';
import { HttpRmsAmountChangeGateway } from '../../../src/main/gateway/rms/rms-amount-change-gateway-http';
import { toChannelId } from '../../../src/main/ids';
import type { OtaAmountChangeReport } from '../../../src/shared/types/amount-change';

const ORIGIN = 'http://localhost:8080';

const REPORT: OtaAmountChangeReport = {
  operationId: '550e8400-e29b-41d4-a716-446655440000',
  loginUserId: 42,
  loginUserName: '张三',
  source: toChannelId('ctrip'),
  endpointUrl: 'https://ebooking.ctrip.com/restapi/soa2/setRCRoomPrice',
  changeType: 'price',
  endpointId: 'setRCRoomPrice',
  otaHotelId: '',
  channelAccountId: '12324831',
  channelAccountName: 'XX酒店',
  changeRaw: {
    roomPriceInfos: [{ roomProductId: '1587157522', salePrice: 723 }],
    dateRanges: [{ startDate: '2026-08-18', endDate: '2026-08-19' }],
  },
  submitAt: '2026-08-12T03:43:56.701Z',
};

function setup(payload: unknown, status = 200) {
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const gateway = new HttpRmsAmountChangeGateway({
    origin: ORIGIN,
    fetch: fetch as unknown as typeof globalThis.fetch,
    logger,
  });
  return { gateway, fetch, logger };
}

function bodyOf(fetch: ReturnType<typeof setup>['fetch']): Record<string, unknown> {
  return JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
}

describe('HttpRmsAmountChangeGateway', () => {
  it('posts the report to the ingest endpoint', async () => {
    const { gateway, fetch } = setup({ code: 0, data: { id: 12345, status: 'DISPATCHED', items: 4 } });

    await gateway.reportAmountChange(REPORT);

    expect(fetch).toHaveBeenCalledWith(
      `${ORIGIN}/api/v1/app/ota-changes`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(bodyOf(fetch)).toMatchObject({
      operationId: REPORT.operationId,
      source: 'ctrip',
      changeType: 'price',
      endpointId: 'setRCRoomPrice',
      otaHotelId: '',
      submitAt: REPORT.submitAt,
    });
  });

  /** changeType 决定 RMS 怎么分流这条上报，漏发等于让服务端无从判断改的是价还是量态。 */
  it('sends changeType for a room-status report too', async () => {
    const { gateway, fetch } = setup({ code: 0, data: { id: 1, status: 'DISPATCHED', items: 1 } });

    await gateway.reportAmountChange({
      ...REPORT,
      changeType: 'roomStatus',
      endpointId: 'setbatchroombookablestatus',
    });

    expect(bodyOf(fetch)).toMatchObject({ changeType: 'roomStatus' });
  });

  it('omits the operator fields — the server takes identity from the JWT, not the payload', async () => {
    const { gateway, fetch } = setup({ code: 0, data: { id: 1, status: 'DISPATCHED', items: 1 } });

    await gateway.reportAmountChange(REPORT);

    const body = bodyOf(fetch);
    expect(body).not.toHaveProperty('loginUserId');
    expect(body).not.toHaveProperty('loginUserName');
  });

  it('passes changeRaw through untouched — the server does the parsing', async () => {
    const { gateway, fetch } = setup({ code: 0, data: { id: 1, status: 'DISPATCHED', items: 1 } });

    await gateway.reportAmountChange(REPORT);

    expect(bodyOf(fetch).changeRaw).toEqual(REPORT.changeRaw);
  });

  it('treats a business status as success — those carry no client-side remedy', async () => {
    // PARSE_FAILED / HOTEL_UNRESOLVED / SKIPPED 都是 code=0 的正常响应：上报是单向通知，
    // 抛错只会让上层白重试一次同样的报文。
    const { gateway, logger } = setup({
      code: 0,
      data: { id: 777, status: 'HOTEL_UNRESOLVED', items: 0 },
    });

    await expect(gateway.reportAmountChange(REPORT)).resolves.toBeUndefined();
    expect(logger.info).toHaveBeenCalledWith(
      'Amount change reported to RMS',
      expect.objectContaining({ rmsStatus: 'HOTEL_UNRESOLVED', rmsChangeId: 777 }),
    );
  });

  it('still resolves when the response data has an unexpected shape', async () => {
    // 响应只进日志，形状对不上不该把一次成功的上报判成失败。
    const { gateway } = setup({ code: 0, data: { unexpected: true } });

    await expect(gateway.reportAmountChange(REPORT)).resolves.toBeUndefined();
  });

  it('throws when the request is structurally rejected', async () => {
    const { gateway } = setup({ code: 40000, message: 'changeRaw 不能为空' }, 400);

    await expect(gateway.reportAmountChange(REPORT)).rejects.toThrow('changeRaw 不能为空');
  });

  it('logs changeRaw as a string so deep payloads survive util.inspect truncation', async () => {
    const { gateway, logger } = setup({ code: 0, data: { id: 1, status: 'DISPATCHED', items: 1 } });

    await gateway.reportAmountChange(REPORT);

    expect(logger.info).toHaveBeenCalledWith(
      'Reporting amount change to RMS',
      expect.objectContaining({ changeRaw: JSON.stringify(REPORT.changeRaw) }),
    );
  });
});
