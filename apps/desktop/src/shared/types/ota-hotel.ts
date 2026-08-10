/**
 * 用户确认后保存的一家渠道酒店信息。本地只保存酒店自身的事实（所属凭证、渠道、
 * OTA 酒店 ID、名称、渠道原始上下文）——OTA 酒店与 RMS 酒店之间的绑定关系由远端
 * 持有，本地不表达，因此这里没有绑定时刻或 RMS 酒店标识这类字段。
 *
 * 探测阶段的产物是候选（`channels/types.ts` 的 `ProbedHotel`），不是这个类型：
 * 探测无副作用，只有用户确认才写入本地。
 */
import type { ChannelId, OtaCredentialId, OtaHotelId } from './ids';
import type { JsonObject } from './json';

export type OtaHotel = Readonly<{
  id: string;
  credentialId: OtaCredentialId;
  channel: ChannelId;
  otaHotelId: OtaHotelId;
  otaHotelName: string | null;
  bindExtra: JsonObject | null;
}>;

/**
 * `save()` 的入参。**不含 `id`**：命中 `(channel, otaHotelId)` 冲突时沿用既有记录的
 * id，新增时才生成——两种情况下调用方传进来的 id 都不会成为最终结果，让调用方编一个
 * 只会让「这个 id 到底生不生效」在读代码时无从判断。id 由仓储自己负责。
 */
export type OtaHotelSaveInput = Omit<OtaHotel, 'id'>;

// 这里曾有 createOtaHotel + InvalidOtaHotelError，唯一的校验是
// `credentialId.length === 0`。但 credentialId 的类型是 branded 的
// OtaCredentialId，只能由 toOtaCredentialId() 产生，而那个函数已经校验过非空
// —— 该分支永远不可达。类型系统能保证的，不再写一遍运行时校验。
