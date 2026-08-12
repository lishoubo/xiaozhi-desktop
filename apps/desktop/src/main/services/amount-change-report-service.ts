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
import type { JsonObject } from '../../shared/types/json';
import { channelAccountNameOf } from '../channels/bind-extra';
import type { RmsAmountChangeGateway } from '../gateway/rms/types';

/**
 * 身份补齐所需的两个窄查询。用函数而不是直接注入 service/仓储对象：这里只需要「查一下」
 * 的能力，注入整个 `StaffAuthService`/`OtaCredentialRepository` 会把不相干的写操作也带进来。
 */
export type AmountChangeIdentityLookup = Readonly<{
  /** 当前登录的操作人。未登录或查不到时返回 null —— 不阻断上报。 */
  currentStaff: () => Promise<{
    userId: number;
    username: string;
    fullName: string | null;
  } | null>;
  /** 这个 partition 对应的渠道账号凭证。查不到返回 null。 */
  credentialByPartition: (partitionName: string) => Promise<{
    channelAccountId: string | null;
    credentialExtra: JsonObject | null;
  } | null>;
}>;

export type AmountChangeReportServiceDependencies = Readonly<{
  gateway: RmsAmountChangeGateway;
  identity: AmountChangeIdentityLookup;
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
  async report(observed: OtaAmountChangeObserved, partitionName: string): Promise<void> {
    // 身份查询失败不阻断上报：改价事实本身比「是谁改的」重要得多，缺了身份 RMS 照样能
    // 靠 otaHotelId/房型反查跟价。所以这里吞掉异常，只留一条 warn。
    const [staff, credential] = await Promise.all([
      this.deps.identity.currentStaff().catch(() => null),
      this.deps.identity.credentialByPartition(partitionName).catch(() => null),
    ]);

    if (!staff) {
      this.deps.logger.warn('Amount change report: no signed-in staff, reporting without operator', {
        source: observed.source,
        endpointId: observed.endpointId,
      });
    }

    const report: OtaAmountChangeReport = {
      ...observed,
      operationId: randomUUID(),
      loginUserId: staff?.userId ?? null,
      loginUserName: staff?.fullName?.trim() || staff?.username || null,
      channelAccountId: credential?.channelAccountId ?? null,
      channelAccountName: channelAccountNameOf(credential?.credentialExtra ?? null),
      submitAt: new Date().toISOString(),
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
