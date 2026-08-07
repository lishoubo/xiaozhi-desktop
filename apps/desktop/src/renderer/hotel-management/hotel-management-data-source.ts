import type {
  RmsHotelCreateInputDto,
  RmsHotelDto,
  RmsHotelOtaAccountsDto,
} from '../../shared/hotel-management';

export interface HotelManagementDataSource {
  load(): Promise<RmsHotelOtaAccountsDto>;
  createHotel(input: RmsHotelCreateInputDto): Promise<RmsHotelDto>;
  deleteHotel(hotelId: number): Promise<void>;
  unbindOtaAccount(otaAccountId: number): Promise<void>;
}

export const desktopHotelManagementDataSource: HotelManagementDataSource = {
  load: () => window.hotelButler.hotelManagement.load(),
  createHotel: (input) => window.hotelButler.hotelManagement.createHotel(input),
  deleteHotel: (hotelId) => window.hotelButler.hotelManagement.deleteHotel(hotelId),
  unbindOtaAccount: (otaAccountId) =>
    window.hotelButler.hotelManagement.unbindOtaAccount(otaAccountId),
};
