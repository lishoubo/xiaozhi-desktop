/**
 * `RmsHotelGateway` 的真实实现——直连 rms-server 的 `/api/v1/app/hotels`。
 *
 * 注意这里**没有一行 token 相关代码**：注入 Bearer、过期刷新、401 重试都由
 * 构造时传入的 `fetch`（`createAuthenticatedRmsFetch` 的产物）负责。新增其他
 * gateway 时照抄这个形状即可，只写业务请求。
 */
import { z } from 'zod';
import {
  createRmsHotel,
  type RmsHotel,
  type RmsHotelCreateInput,
} from '../../../shared/types/rms-hotel';
import { createRmsApiCall, type RmsApiCall, type RmsApiCallerDependencies } from './rms-api-call';
import type { RmsHotelGateway } from './types';

/** 对齐 rms-server 的 `AppHotelResponse`。 */
const hotelSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  status: z.number().int(),
});

export type HttpRmsHotelGatewayDependencies = Omit<RmsApiCallerDependencies, 'subject'>;

export class HttpRmsHotelGateway implements RmsHotelGateway {
  private readonly call: RmsApiCall;

  constructor(deps: HttpRmsHotelGatewayDependencies) {
    this.call = createRmsApiCall({ ...deps, subject: '酒店服务' });
  }

  async listHotels(): Promise<readonly RmsHotel[]> {
    const data = await this.call('listHotels', 'GET', '/api/v1/app/hotels');
    return z
      .array(hotelSchema)
      .parse(data)
      .map((hotel) => createRmsHotel(hotel));
  }

  /**
   * 新建测试酒店。远端端点由 `rms.app.hotel-crud.enabled` 控制，默认关闭——
   * 关闭时整个 Bean 不注册，这里会收到 404/405 而非业务错误。
   */
  async createHotel(input: RmsHotelCreateInput): Promise<RmsHotel> {
    const data = await this.call('createHotel', 'POST', '/api/v1/app/hotels', {
      name: input.name,
    });
    return createRmsHotel(hotelSchema.parse(data));
  }

  async deleteHotel(hotelId: number): Promise<void> {
    await this.call('deleteHotel', 'DELETE', `/api/v1/app/hotels/${hotelId}`);
  }
}
