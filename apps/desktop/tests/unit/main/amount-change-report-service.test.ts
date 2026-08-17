import { describe, expect, it, vi } from 'vitest';
import { AmountChangeReportService } from '../../../src/main/services/amount-change-report-service';
import { toChannelId } from '../../../src/main/ids';
import type {
  OtaAmountChangeObserved,
  OtaAmountChangeReport,
} from '../../../src/shared/types/amount-change';
import type { JsonObject } from '../../../src/shared/types/json';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const OBSERVED: OtaAmountChangeObserved = {
  source: toChannelId('douyin'),
  changeType: 'price',
  endpointId: 'save_amount_calendar',
  endpointUrl: 'https://life.douyin.com/life/trip/hotel/save_amount_calendar',
  otaHotelId: '7245504927202543672',
  changeRaw: { amount_change_type: 1 },
};

const PARTITION = 'persist:xiaozhi:prod:douyin:abc123';

/** 默认的身份查询：登录人 + 渠道账号都查得到。 */
function createIdentity(
  overrides: Partial<{
    currentStaff: () => Promise<{ userId: number; username: string; fullName: string | null } | null>;
    credentialByPartition: (
      partitionName: string,
    ) => Promise<{ channelAccountId: string | null; credentialExtra: JsonObject | null } | null>;
  }> = {},
) {
  return {
    currentStaff: () =>
      Promise.resolve({ userId: 42, username: 'lisb', fullName: '李守波' as string | null }),
    credentialByPartition: () =>
      Promise.resolve({
        channelAccountId: '7426783989676935218',
        credentialExtra: { hotelName: '苏州平江府' } as JsonObject | null,
      }),
    ...overrides,
  };
}

describe('AmountChangeReportService', () => {
  it('补上 operationId、submitAt 与身份信息后交给 gateway', async () => {
    const reportAmountChange = vi.fn((_report: OtaAmountChangeReport) => Promise.resolve());
    const service = new AmountChangeReportService({
      gateway: { reportAmountChange },
      identity: createIdentity(),
      logger: createLogger(),
    });

    await service.report(OBSERVED, PARTITION);

    expect(reportAmountChange).toHaveBeenCalledTimes(1);
    const sent = reportAmountChange.mock.calls[0][0] as Record<string, unknown>;
    expect(sent).toMatchObject(OBSERVED);
    expect(typeof sent.operationId).toBe('string');
    expect((sent.operationId as string).length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(sent.submitAt as string))).toBe(false);
    // 身份补齐：操作人取 fullName（优先于 username），渠道账号取凭证。
    expect(sent.loginUserId).toBe(42);
    expect(sent.loginUserName).toBe('李守波');
    expect(sent.channelAccountId).toBe('7426783989676935218');
    expect(sent.channelAccountName).toBe('苏州平江府');
  });

  /**
   * 美团的 `credentialExtra` 里既没有 `hotelName` 也没有 `name`，只有 `login`
   * （2026-08-12 真机确认：`{partnerId, login, accountType, accountStatus, maskedPhone}`）。
   * 名字解析必须与绑定链路同一份实现——此前这里另写了一套键表漏掉 `login`，
   * 同一个账号在酒店卡片上有名字、改价上报里却是 null。
   */
  it('美团凭证取 login 作为渠道账号名', async () => {
    const reportAmountChange = vi.fn((_report: OtaAmountChangeReport) => Promise.resolve());
    const service = new AmountChangeReportService({
      gateway: { reportAmountChange },
      identity: createIdentity({
        credentialByPartition: () =>
          Promise.resolve({
            channelAccountId: '274615733',
            credentialExtra: {
              partnerId: '4595635',
              login: 'Btphhldxm',
              accountType: 1,
              accountStatus: 1,
              maskedPhone: '186****8804',
            } as JsonObject | null,
          }),
      }),
      logger: createLogger(),
    });

    await service.report(OBSERVED, PARTITION);

    const sent = reportAmountChange.mock.calls[0][0] as Record<string, unknown>;
    expect(sent.channelAccountName).toBe('Btphhldxm');
  });

  /** 身份查不到不能阻断上报：改价事实本身比「谁改的」重要。 */
  it('未登录 / 查不到凭证时身份字段留 null，照常上报', async () => {
    const reportAmountChange = vi.fn((_report: OtaAmountChangeReport) => Promise.resolve());
    const logger = createLogger();
    const service = new AmountChangeReportService({
      gateway: { reportAmountChange },
      identity: createIdentity({
        currentStaff: () => Promise.resolve(null),
        credentialByPartition: () => Promise.resolve(null),
      }),
      logger,
    });

    await service.report(OBSERVED, PARTITION);

    expect(reportAmountChange).toHaveBeenCalledTimes(1);
    const sent = reportAmountChange.mock.calls[0][0] as Record<string, unknown>;
    expect(sent.loginUserId).toBeNull();
    expect(sent.loginUserName).toBeNull();
    expect(sent.channelAccountId).toBeNull();
    expect(sent.channelAccountName).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  /** 身份查询抛异常同样不能阻断（网络抖动会让 currentSession 抛）。 */
  it('身份查询抛异常时吞掉，照常上报', async () => {
    const reportAmountChange = vi.fn((_report: OtaAmountChangeReport) => Promise.resolve());
    const service = new AmountChangeReportService({
      gateway: { reportAmountChange },
      identity: createIdentity({
        currentStaff: () => Promise.reject(new Error('network down')),
      }),
      logger: createLogger(),
    });

    await expect(service.report(OBSERVED, PARTITION)).resolves.toBeUndefined();
    expect(reportAmountChange).toHaveBeenCalledTimes(1);
    expect((reportAmountChange.mock.calls[0][0] as Record<string, unknown>).loginUserId).toBeNull();
  });

  /** fullName 为空时回退到 username —— 名字总得有一个。 */
  it('fullName 缺失时用 username 当操作人名字', async () => {
    const reportAmountChange = vi.fn((_report: OtaAmountChangeReport) => Promise.resolve());
    const service = new AmountChangeReportService({
      gateway: { reportAmountChange },
      identity: createIdentity({
        currentStaff: () => Promise.resolve({ userId: 7, username: 'lisb', fullName: null }),
      }),
      logger: createLogger(),
    });

    await service.report(OBSERVED, PARTITION);

    expect((reportAmountChange.mock.calls[0][0] as Record<string, unknown>).loginUserName).toBe(
      'lisb',
    );
  });

  it('第一次失败会重试一次，且两次用同一个 operationId（幂等键不能变）', async () => {
    const reportAmountChange = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);
    const service = new AmountChangeReportService({
      gateway: { reportAmountChange },
      identity: createIdentity(),
      logger: createLogger(),
    });

    await service.report(OBSERVED, PARTITION);

    expect(reportAmountChange).toHaveBeenCalledTimes(2);
    const first = reportAmountChange.mock.calls[0][0] as Record<string, unknown>;
    const second = reportAmountChange.mock.calls[1][0] as Record<string, unknown>;
    expect(second.operationId).toBe(first.operationId);
  });

  it('两次都失败则放弃并告警，不向上抛（没有人在等这个结果）', async () => {
    const reportAmountChange = vi.fn(() => Promise.reject(new Error('boom')));
    const logger = createLogger();
    const service = new AmountChangeReportService({
      gateway: { reportAmountChange },
      identity: createIdentity(),
      logger,
    });

    await expect(service.report(OBSERVED, PARTITION)).resolves.toBeUndefined();

    expect(reportAmountChange).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('giving up'),
      expect.anything(),
    );
  });
});

/**
 * 🔴 携程同一家酒店的预付与现付是**两个不同的 hotelID**，报文里出现的是本次操作那一侧。
 * 真机实测：报文 115348672，而 RMS 登记的是 masterHotelId 85068938 —— 直接透传会让
 * RMS 有一半的改动反查不到门店。
 */
describe('AmountChangeReportService —— 携程门店 ID 归一', () => {
  const CTRIP_OBSERVED: OtaAmountChangeObserved = {
    source: toChannelId('ctrip'),
    changeType: 'roomStatus',
    endpointId: 'setbatchroombookablestatus',
    endpointUrl: 'https://ebooking.ctrip.com/ebkovsroom/api/inventory/setbatchroombookablestatus',
    otaHotelId: '115348672',
    changeRaw: { hotelRoomInfoDtoList: [{ hotelID: 115348672 }] },
  };

  function reportCtripWith(credentialExtra: JsonObject | null) {
    const reportAmountChange = vi.fn((_report: OtaAmountChangeReport) => Promise.resolve());
    const service = new AmountChangeReportService({
      gateway: { reportAmountChange },
      identity: createIdentity({
        credentialByPartition: () =>
          Promise.resolve({ channelAccountId: '12324831', credentialExtra }),
      }),
      logger: createLogger(),
    });
    return { reportAmountChange, run: () => service.report(CTRIP_OBSERVED, PARTITION) };
  }

  it('用凭证里的 masterHotelId 覆盖报文里的门店 ID', async () => {
    const { reportAmountChange, run } = reportCtripWith({ masterHotelId: 85068938 });
    await run();
    expect(reportAmountChange.mock.calls[0]?.[0].otaHotelId).toBe('85068938');
  });

  it('masterHotelId 是字符串时同样生效', async () => {
    const { reportAmountChange, run } = reportCtripWith({ masterHotelId: '85068938' });
    await run();
    expect(reportAmountChange.mock.calls[0]?.[0].otaHotelId).toBe('85068938');
  });

  it('changeRaw 原样保留 —— 多店操作的全量清单以它为准', async () => {
    const { reportAmountChange, run } = reportCtripWith({ masterHotelId: 85068938 });
    await run();
    expect(reportAmountChange.mock.calls[0]?.[0].changeRaw).toEqual(CTRIP_OBSERVED.changeRaw);
  });

  it('拿不到 masterHotelId 时保留报文原值，而不是清空', async () => {
    const { reportAmountChange, run } = reportCtripWith({ hotelName: '银际酒店' });
    await run();
    expect(reportAmountChange.mock.calls[0]?.[0].otaHotelId).toBe('115348672');
  });

  it('查不到凭证时保留报文原值', async () => {
    const reportAmountChange = vi.fn((_report: OtaAmountChangeReport) => Promise.resolve());
    const service = new AmountChangeReportService({
      gateway: { reportAmountChange },
      identity: createIdentity({ credentialByPartition: () => Promise.resolve(null) }),
      logger: createLogger(),
    });
    await service.report(CTRIP_OBSERVED, PARTITION);
    expect(reportAmountChange.mock.calls[0]?.[0].otaHotelId).toBe('115348672');
  });

  it('其他渠道不受影响 —— 抖音/美团没有一店两 ID 的形状', async () => {
    const reportAmountChange = vi.fn((_report: OtaAmountChangeReport) => Promise.resolve());
    const service = new AmountChangeReportService({
      gateway: { reportAmountChange },
      identity: createIdentity({
        credentialByPartition: () =>
          Promise.resolve({ channelAccountId: 'x', credentialExtra: { masterHotelId: 99999 } }),
      }),
      logger: createLogger(),
    });
    await service.report(OBSERVED, PARTITION);
    expect(reportAmountChange.mock.calls[0]?.[0].otaHotelId).toBe(OBSERVED.otaHotelId);
  });
});
