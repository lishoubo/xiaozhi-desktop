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

    const otaHotelId = this.resolveOtaHotelId(observed, credential?.credentialExtra ?? null);

    const report: OtaAmountChangeReport = {
      ...observed,
      otaHotelId,
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

  /**
   * 携程专用：用凭证里的 `masterHotelId` 覆盖报文里的门店 ID。
   *
   * ## 为什么必须覆盖
   *
   * 携程**同一家酒店的预付与现付是两个不同的 hotelID**，报文里出现的是本次操作那一侧的
   * ID（真机实测：报文 `115348672`，而 RMS 登记的是 `85068938`）。直接透传的话，RMS
   * 有一半的改动反查不到门店。`masterHotelId` 是账号维度的稳定标识，与预付/现付无关，
   * 也正是绑定探测所用的那一个（见 `channels/ctrip/hotel-prob.ts`），两边口径这才对齐。
   *
   * ## 为什么只对携程做
   *
   * 抖音与美团没有这种一店两 ID 的形状，报文里的门店 ID 就是唯一的那个，覆盖只会引入
   * 偏差。这也是**不把它做成通用规则**的原因。
   *
   * ## 拿不到时保留原值
   *
   * `masterHotelId` 来自登录后抓取的账号信息，理论上必有（`HEAppInfo` 与 `HEUbtBaseData`
   * 两条来源都带），但 schema 里是可空的——账号未探测、老凭证、抓取时机不巧都可能缺。
   * 缺失时**保留报文原值**而不是清空：一个可能对不上的 ID，仍然比没有 ID 更有反查价值。
   *
   * ⚠️ 只改顶层提示字段，`changeRaw` 原样保留 —— 一次操作可能涉及多家门店，全量清单
   * 始终以 `changeRaw` 为准（见 `channels/ctrip/room-status-payload.ts`）。
   */
  private resolveOtaHotelId(
    observed: OtaAmountChangeObserved,
    credentialExtra: JsonObject | null,
  ): string {
    if (observed.source !== 'ctrip' || credentialExtra === null) return observed.otaHotelId;

    const raw = credentialExtra.masterHotelId;
    const masterHotelId =
      typeof raw === 'number' && Number.isFinite(raw)
        ? String(raw)
        : typeof raw === 'string' && raw.trim().length > 0
          ? raw.trim()
          : null;
    if (masterHotelId === null) {
      this.deps.logger.warn('Ctrip credential has no masterHotelId; reporting payload hotel id', {
        source: observed.source,
        endpointId: observed.endpointId,
        otaHotelId: observed.otaHotelId,
      });
      return observed.otaHotelId;
    }

    if (masterHotelId !== observed.otaHotelId) {
      // 不是异常，是携程预付/现付双 ID 的常态。记一条便于日后对账。
      this.deps.logger.info('Ctrip hotel id replaced with masterHotelId', {
        source: observed.source,
        endpointId: observed.endpointId,
        payloadHotelId: observed.otaHotelId,
        masterHotelId,
      });
    }
    return masterHotelId;
  }
}
