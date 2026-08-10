import { describe, expect, it, vi } from 'vitest';
import { AmountChangeReportService } from '../../../src/main/services/amount-change-report-service';
import { toChannelId } from '../../../src/main/ids';
import type {
  OtaAmountChangeObserved,
  OtaAmountChangeReport,
} from '../../../src/shared/types/amount-change';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const OBSERVED: OtaAmountChangeObserved = {
  source: toChannelId('douyin'),
  endpointId: 'save_amount_calendar',
  otaHotelId: '7245504927202543672',
  channelExtra: { merchantGroupId: '1813179858562059', lifeAccountId: '7426783989676935218' },
  requestBody: { amount_change_type: 1 },
};

describe('AmountChangeReportService', () => {
  it('补上 operationId 与 observedAt 后交给 gateway', async () => {
    const reportAmountChange = vi.fn((_report: OtaAmountChangeReport) => Promise.resolve());
    const service = new AmountChangeReportService({
      gateway: { reportAmountChange },
      logger: createLogger(),
    });

    await service.report(OBSERVED);

    expect(reportAmountChange).toHaveBeenCalledTimes(1);
    const sent = reportAmountChange.mock.calls[0][0] as Record<string, unknown>;
    expect(sent).toMatchObject(OBSERVED);
    expect(typeof sent.operationId).toBe('string');
    expect((sent.operationId as string).length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(sent.observedAt as string))).toBe(false);
  });

  it('第一次失败会重试一次，且两次用同一个 operationId（幂等键不能变）', async () => {
    const reportAmountChange = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);
    const service = new AmountChangeReportService({
      gateway: { reportAmountChange },
      logger: createLogger(),
    });

    await service.report(OBSERVED);

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
      logger,
    });

    await expect(service.report(OBSERVED)).resolves.toBeUndefined();

    expect(reportAmountChange).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('giving up'),
      expect.anything(),
    );
  });
});
