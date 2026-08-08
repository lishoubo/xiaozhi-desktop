import { createRmsHotel, type RmsHotel, type RmsHotelCreateInput } from '../../../domain/rms-hotel';
import type { RmsHotelGateway } from '../../../main/gateway/rms/types';

const SEED_HOTELS: readonly RmsHotel[] = [
  createRmsHotel({ id: 1001, name: '上海云栖酒店', status: 1 }),
  createRmsHotel({ id: 1002, name: '杭州西溪悦榕酒店', status: 1 }),
  createRmsHotel({ id: 1003, name: '苏州平江府', status: 1 }),
];

export class MockRmsHotelGateway implements RmsHotelGateway {
  private hotels: RmsHotel[] = [...SEED_HOTELS];
  private nextId = 1004;

  async listHotels(): Promise<readonly RmsHotel[]> {
    return this.hotels;
  }

  async createHotel(input: RmsHotelCreateInput): Promise<RmsHotel> {
    const hotel = createRmsHotel({ id: this.nextId, name: input.name, status: 1 });
    this.nextId += 1;
    this.hotels = [...this.hotels, hotel];
    return hotel;
  }

  async deleteHotel(hotelId: number): Promise<void> {
    const exists = this.hotels.some((hotel) => hotel.id === hotelId);
    if (!exists) {
      throw new Error('酒店不存在或已被删除');
    }
    this.hotels = this.hotels.filter((hotel) => hotel.id !== hotelId);
  }
}
