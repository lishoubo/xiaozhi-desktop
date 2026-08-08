import { z } from 'zod';
import { toOtaHotelId, type OtaHotelId } from '../../ids';

const parsedHotelSchema = z.array(
  z.object({
    hotelId: z.string(),
    hotelName: z.string(),
  }),
);

export type CtripDiscoveredHotel = Readonly<{
  otaHotelId: OtaHotelId;
  otaHotelName: string;
  bindExtra: null;
}>;

export function parseCtripHotelDom(raw: unknown): readonly CtripDiscoveredHotel[] | null {
  const parsed = parsedHotelSchema.safeParse(raw);
  if (!parsed.success) return null;

  return parsed.data.flatMap((hotel): readonly CtripDiscoveredHotel[] => {
    const hotelId = hotel.hotelId.trim();
    const hotelName = hotel.hotelName.trim();
    if (hotelId.length === 0 || hotelName.length === 0) return [];
    return [
      {
        otaHotelId: toOtaHotelId(hotelId),
        otaHotelName: hotelName,
        bindExtra: null,
      },
    ];
  });
}

export const READ_CTRIP_HOTELS_EXPRESSION = `
  new Promise((resolve) => {
    const parse = () => Array.from(document.querySelectorAll('a.he-ctrip-hotel-title-link'))
      .map((element) => {
        const href = element.getAttribute('href') || '';
        const match = href.match(/\\/hotels?\\/(\\d+)/);
        return {
          hotelId: match ? match[1] : '',
          hotelName: (element.textContent || '').trim(),
        };
      })
      .filter((hotel) => hotel.hotelId && hotel.hotelName);

    const initial = parse();
    if (initial.length > 0) {
      resolve(initial);
      return;
    }

    const interval = setInterval(() => {
      const hotels = parse();
      if (hotels.length === 0) return;
      clearInterval(interval);
      clearTimeout(timeout);
      resolve(hotels);
    }, 200);
    const timeout = setTimeout(() => {
      clearInterval(interval);
      resolve(parse());
    }, 15000);
  })
`;
