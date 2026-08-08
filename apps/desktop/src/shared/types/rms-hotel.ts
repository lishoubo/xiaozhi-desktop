/** RMS 酒店的最小投影，desktop 只需要展示与操作所需字段。 */
export type RmsHotel = Readonly<{
  id: number;
  name: string;
  status: number;
}>;

export type RmsHotelCreateInput = Readonly<{
  name: string;
}>;

export class InvalidRmsHotelError extends Error {
  constructor(reason: string) {
    super(`无效的 RmsHotel：${reason}`);
    this.name = 'InvalidRmsHotelError';
  }
}

export function createRmsHotel(
  input: RmsHotelCreateInput & { id: number; status: number },
): RmsHotel {
  if (input.id <= 0) {
    throw new InvalidRmsHotelError('id 必须为正整数');
  }
  if (input.name.trim().length === 0) {
    throw new InvalidRmsHotelError('name 不能为空');
  }
  return { id: input.id, name: input.name, status: input.status };
}
