/**
 * `RmsAmountChangeGateway` 的真实实现——直连 rms-server 的
 * `POST /api/v1/app/ota-changes`（`AppOtaChangeController`）。
 *
 * 与其余两个 gateway 一样，这里**没有一行 token 相关代码**：注入 Bearer、过期刷新、
 * 401 重试都由构造时传入的 `fetch` 负责。
 *
 * ## 与另外两个 gateway 的三点不同
 *
 * 1. **不发 `loginUserId` / `loginUserName`**：远端 DTO 明说不接收这两个字段——报文可伪造，
 *    服务端一律以 JWT 为准（desktop 的 `loginUserId` 取的本来就是 RMS 员工身份，JWT 里已经
 *    有了）。契约里保留它们是为了 mock 日志与本地排查，发出去只是白占带宽。
 * 2. **返回值不解析成领域对象**：远端回 `{id, status, items}`，其中 `status` 是**处理终态**
 *    而非成败——`PARSE_FAILED` / `HOTEL_UNRESOLVED` / `SKIPPED` 都是 `code=0` 的正常响应
 *    （上报是单向通知，失败沉淀成台账数据）。desktop 没有任何补救动作，所以只记一条日志，
 *    不据此抛错、不触发重试。
 * 3. **`otaHotelId` 为空串照发**：远端靠报文里的房型 id 反查门店，空值不是错误。
 *
 * ## 什么情况下会抛
 *
 * 只有传输层/结构层失败：网络断、非 `ApiResponse` 形状、`code != 0`（401 无登录态、
 * 400 请求体结构性错误）。抛出后由 `AmountChangeReportService` 重试 1 次再放弃——
 * 那一层已经吞掉异常，不会冒泡成 unhandled rejection。
 */
import { z } from 'zod';
import type { OtaAmountChangeReport } from '../../../shared/types/amount-change';
import { createRmsApiCall, type RmsApiCall, type RmsApiCallerDependencies } from './rms-api-call';
import type { RmsAmountChangeGateway } from './types';

/**
 * 对齐 `AppOtaChangeController` 的响应 `data`。
 *
 * 全部 `.nullish()`：撞唯一键却查不到那条时远端会回 `id: null`（见 `IngestService` 的
 * `DuplicateKeyException` 分支）。这份响应只进日志，形状对不上也不该让上报失败——
 * 所以用 `safeParse` 而非 `parse`。
 */
const ingestResultSchema = z.object({
  id: z.number().nullish(),
  status: z.string().nullish(),
  items: z.number().nullish(),
});

export type HttpRmsAmountChangeGatewayDependencies = Omit<RmsApiCallerDependencies, 'subject'>;

export class HttpRmsAmountChangeGateway implements RmsAmountChangeGateway {
  private readonly call: RmsApiCall;

  constructor(private readonly deps: HttpRmsAmountChangeGatewayDependencies) {
    this.call = createRmsApiCall({ ...deps, subject: '价量态上报服务' });
  }

  async reportAmountChange(report: OtaAmountChangeReport): Promise<void> {
    // 发之前先完整落盘一次。真机联调时这条日志是唯一能还原「我们到底发了什么」的记录——
    // 服务端拿到解析失败只会回一个 status，对不上就得靠这里。
    //
    // ⚠️ `changeRaw` **先 JSON.stringify 再交给日志**，不能直接传对象。日志底层是 Node 的
    // `util.inspect`，超过 depth 的部分在写入那一刻就被写成 `[Object]`，事后无法从日志文件
    // 还原。渠道数据的嵌套深度不由我们控制：美团实测两种形状，价格恰好落在最深处
    // （2026-08-11 真机两次踩到，第二次连调大后的 depth 都不够）。字符串没有嵌套，任何深度
    // 都完整落盘——这是结构性解决，不必再为每种新形状猜 depth。代价只是日志里这个字段是
    // 紧凑 JSON，排查时管道过一下 `jq` 即可。
    this.deps.logger.info('Reporting amount change to RMS', {
      operationId: report.operationId,
      loginUserId: report.loginUserId,
      loginUserName: report.loginUserName,
      source: report.source,
      endpointUrl: report.endpointUrl,
      endpointId: report.endpointId,
      otaHotelId: report.otaHotelId,
      channelAccountId: report.channelAccountId,
      channelAccountName: report.channelAccountName,
      changeRaw: JSON.stringify(report.changeRaw),
      submitAt: report.submitAt,
    });

    const data = await this.call('reportAmountChange', 'POST', '/api/v1/app/ota-changes', {
      operationId: report.operationId,
      source: report.source,
      endpointId: report.endpointId,
      endpointUrl: report.endpointUrl,
      otaHotelId: report.otaHotelId,
      channelAccountId: report.channelAccountId,
      channelAccountName: report.channelAccountName,
      changeRaw: report.changeRaw,
      submitAt: report.submitAt,
    });

    const parsed = ingestResultSchema.safeParse(data);
    // 终态只记日志：desktop 对 PARSE_FAILED / HOTEL_UNRESOLVED / SKIPPED 都没有补救动作，
    // 重试同一份报文只会再走同一条分支。排查时靠 operationId 与远端台账对上。
    this.deps.logger.info('Amount change reported to RMS', {
      operationId: report.operationId,
      source: report.source,
      endpointId: report.endpointId,
      rmsChangeId: parsed.success ? (parsed.data.id ?? null) : null,
      rmsStatus: parsed.success ? (parsed.data.status ?? null) : null,
      rmsItems: parsed.success ? (parsed.data.items ?? null) : null,
    });
  }
}
