/** RMS OTA account 的最小投影：远端酒店渠道绑定的最小事实，不携带凭证。 */
import type { ChannelId } from './identity';
import type { JsonObject } from './json';

export type RmsOtaAccount = Readonly<{
  id: number;
  hotelId: number;
  otaHotelId: string | null;
  otaHotelName: string | null;
  status: string;
  source: ChannelId;
  bindExtra: JsonObject | null;
}>;

export class InvalidRmsOtaAccountError extends Error {
  constructor(reason: string) {
    super(`无效的 RmsOtaAccount：${reason}`);
    this.name = 'InvalidRmsOtaAccountError';
  }
}

export function createRmsOtaAccount(input: RmsOtaAccount): RmsOtaAccount {
  if (input.id <= 0) {
    throw new InvalidRmsOtaAccountError('id 必须为正整数');
  }
  if (input.hotelId <= 0) {
    throw new InvalidRmsOtaAccountError('hotelId 必须为正整数');
  }
  if (input.status.trim().length === 0) {
    throw new InvalidRmsOtaAccountError('status 不能为空');
  }
  return { ...input };
}
