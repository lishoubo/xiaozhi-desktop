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
    iconUrl: 'https://www.ctrip.com/favicon.ico',
  },
  {
    id: 'meituan-hotel',
    name: '美团酒店',
    url: 'https://ebooking.meituan.com/ebk/login/login.html',
    iconUrl: 'https://www.meituan.com/favicon.ico',
  },
  {
    id: 'meituan-minsu',
    name: '美团民宿',
    url: 'https://minsu.meituan.com/',
    iconUrl: 'https://www.meituan.com/favicon.ico',
  },
  {
    id: 'fliggy',
    name: '飞猪酒店商家',
    url: 'https://hotel.fliggy.com/ebooking/hotelBaseInfoUv.htm',
    iconUrl: 'https://www.fliggy.com/favicon.ico',
  },
  {
    id: 'douyin',
    name: '抖音来客',
    url: 'https://life.douyin.com/p/login',
    iconUrl: 'https://www.douyin.com/favicon.ico',
  },
  {
    id: 'xiaohongshu',
    name: '小红书本地生活',
    url: 'https://merchant.xiaohongshu.com/',
    iconUrl: 'https://www.xiaohongshu.com/favicon.ico',
  },
  {
    id: 'tujia',
    name: '途家民宿',
    url: 'https://bj.tujia.com/seller/login',
    iconUrl: 'https://www.tujia.com/favicon.ico',
  },
  {
    id: 'booking',
    name: 'Booking.com',
    url: 'https://admin.booking.com/hotel/',
    iconUrl: 'https://www.booking.com/favicon.ico',
  },
  {
    id: 'agoda',
    name: 'Agoda',
    url: 'https://ycs.agoda.com/',
    iconUrl: 'https://www.agoda.com/favicon.ico',
  },
  {
    id: 'expedia',
    name: 'Expedia',
    url: 'https://partner.expedia.com/',
    iconUrl: 'https://www.expedia.com/favicon.ico',
  },
];
