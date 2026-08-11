/**
 * 把观测到的价量态改动上报给 RMS。
 *
 * 这一层很薄，只做两件事：补上 `operationId`/`observedAt`，然后调 gateway。之所以仍然存在
 * 而不让 watcher 直接调 gateway —— `channels/` 被 eslint 禁止依赖 `gateway/`，需要一个
 * `services/` 层的落点；同时「幂等键怎么生成、失败怎么办」属于上报语义，不该混进拦截逻辑。
 *
 * **不依赖 `database/`**：desktop 不查本地绑定、不算 hotelId，反查绑定是 RMS 的职责
 * （见 `shared/types/amount-change.ts` 的说明）。所以这个 service 没有仓储依赖。
 */
import { randomUUID } from 'node:crypto';
import type { AppLogger } from '../../shared/logging';
import type {
  OtaAmountChangeObserved,
  OtaAmountChangeReport,
} from '../../shared/types/amount-change';
import type { RmsAmountChangeGateway } from '../gateway/rms/types';

export type AmountChangeReportServiceDependencies = Readonly<{
  gateway: RmsAmountChangeGateway;
  logger: AppLogger;
}>;

export class AmountChangeReportService {
  constructor(private readonly deps: AmountChangeReportServiceDependencies) {}

  /**
   * 上报一次改动。**不抛异常**：调用方是浏览器里的用户操作，没有人在等这个结果，往上抛只会
   * 变成 unhandled rejection。
   *
   * 失败重试一次后放弃。不落盘重试是有意的取舍：跟价的时效性很强，隔几分钟才补报上去，RMS
   * 那边可能已经不适用了；而落盘队列会牵出「重启后补报」「顺序保证」一串问题。代价是偶发漏报
   * —— 已知，日志留痕。
   */
  async report(observed: OtaAmountChangeObserved): Promise<void> {
    const report: OtaAmountChangeReport = {
      ...observed,
      operationId: randomUUID(),
      observedAt: new Date().toISOString(),
    };

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await this.deps.gateway.reportAmountChange(report);
        return;
      } catch (error) {
        const isLastAttempt = attempt === 2;
        this.deps.logger.warn(
          isLastAttempt
            ? 'Amount change report failed, giving up'
            : 'Amount change report failed, retrying once',
          {
            operationId: report.operationId,
            source: report.source,
            otaHotelId: report.otaHotelId,
            attempt,
            errorName: error instanceof Error ? error.name : 'UnknownError',
          },
        );
      }
    }
  }
}
