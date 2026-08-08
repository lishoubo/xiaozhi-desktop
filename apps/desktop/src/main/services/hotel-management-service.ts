import type { RmsHotelGateway, RmsOtaAccountGateway } from '../gateway/rms/types';
import type { RmsHotelCreateInput, RmsHotel } from '../../shared/types/rms-hotel';
import type { RmsOtaAccount } from '../../shared/types/rms-ota-account';

export type RmsHotelOtaAccountsSnapshot = Readonly<{
  hotels: readonly RmsHotel[];
  otaAccounts: readonly RmsOtaAccount[];
}>;

/** 酒店管理页的远端查询与 CRUD 编排；不理解 OTA 绑定探测流程。 */
export class HotelManagementService {
  constructor(
    private readonly hotelGateway: RmsHotelGateway,
    private readonly otaAccountGateway: RmsOtaAccountGateway,
  ) {}

  async load(): Promise<RmsHotelOtaAccountsSnapshot> {
    const [hotels, otaAccounts] = await Promise.all([
      this.hotelGateway.listHotels(),
      this.otaAccountGateway.listOtaAccounts(),
    ]);
    return { hotels, otaAccounts };
  }

  async createHotel(input: RmsHotelCreateInput): Promise<RmsHotel> {
    return this.hotelGateway.createHotel(input);
  }

  async deleteHotel(hotelId: number): Promise<void> {
    await this.hotelGateway.deleteHotel(hotelId);
  }

  async unbindOtaAccount(otaAccountId: number): Promise<void> {
    await this.otaAccountGateway.unbind(otaAccountId);
  }
}
