import { OTA_ICONS } from './ota-icons';

export type OtaChannel = Readonly<{
  id: string;
  name: string;
  url: string;
  iconUrl: string;
}>;

export const OTA_CHANNELS: readonly OtaChannel[] = [
  {
    id: 'ctrip',
    name: '携程酒店 eBooking',
    url: 'https://ebooking.ctrip.com/',
    iconUrl: OTA_ICONS.ctrip,
  },
  {
    id: 'meituan-hotel',
    name: '美团酒店',
    url: 'https://ebooking.meituan.com/ebk/login/login.html',
    iconUrl: OTA_ICONS.meituan,
  },
  {
    id: 'meituan-minsu',
    name: '美团民宿',
    url: 'https://minsu.meituan.com/',
    iconUrl: OTA_ICONS.meituan,
  },
  {
    id: 'fliggy',
    name: '飞猪酒店商家',
    url: 'https://hotel.fliggy.com/ebooking/hotelBaseInfoUv.htm',
    iconUrl: OTA_ICONS.fliggy,
  },
  {
    id: 'douyin',
    name: '抖音来客',
    url: 'https://life.douyin.com/p/login',
    iconUrl: OTA_ICONS.douyin,
  },
  {
    id: 'xiaohongshu',
    name: '小红书本地生活',
    url: 'https://merchant.xiaohongshu.com/',
    iconUrl: OTA_ICONS.xiaohongshu,
  },
  {
    id: 'tujia',
    name: '途家民宿',
    url: 'https://bj.tujia.com/seller/login',
    iconUrl: OTA_ICONS.tujia,
  },
  {
    id: 'booking',
    name: 'Booking.com',
    url: 'https://admin.booking.com/hotel/',
    iconUrl: OTA_ICONS.booking,
  },
  {
    id: 'agoda',
    name: 'Agoda',
    url: 'https://ycs.agoda.com/',
    iconUrl: OTA_ICONS.agoda,
  },
  {
    id: 'expedia',
    name: 'Expedia',
    url: 'https://partner.expedia.com/',
    iconUrl: OTA_ICONS.expedia,
  },
];
