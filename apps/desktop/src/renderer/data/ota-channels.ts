import { OTA_ICONS } from './ota-icons';

export type OtaChannel = Readonly<{
  id: string;
  name: string;
  shortName: string;
  url: string;
  iconUrl: string;
}>;

/**
 * 支持酒店绑定的渠道 —— 与主进程 `channels/registry.ts` 注册了 `hotelProbe` 的那三个
 * 一致。没有 probe 的渠道登录后探测不出候选，绑定流程走不完，因此绑定入口不能列出它们。
 *
 * ⚠ 主进程新增渠道适配器时要同步这里。两处分处不同进程，无法用类型系统关联。
 */
export const BINDABLE_CHANNEL_IDS: readonly string[] = ['ctrip', 'douyin', 'meituan'];

/**
 * 浏览器工作区顶部展示哪些渠道入口。
 *
 * 只留已经接通改价/房态监听与账号探测的那三个：入口太多会让工作区顶部拥挤，而其余渠道
 * 点进去也只是个空浏览器——既探测不出账号，也不上报任何改动，对用户没有价值。
 *
 * ⚠️ **不是从 `OTA_CHANNELS` 里删条目**：`account.source` 是远端存下来的历史数据，各处
 * 都用 `OTA_CHANNELS.find()` 把它翻译成中文名（酒店卡片、重认弹窗、cookie 列表）。删了
 * 定义，那些记录就会退化成显示 `fliggy` 这样的裸 id。定义留着，只控制入口是否展示。
 *
 * 恢复某个渠道时把它加回这个数组即可；`OTA_CHANNELS` 里的定义一直都在。
 */
export const WORKSPACE_CHANNEL_IDS: readonly string[] = ['ctrip', 'meituan', 'douyin'];

/**
 * 全部渠道定义。**这里是「id → 展示信息」的字典，不是「展示哪些入口」的清单**
 * —— 后者见 `WORKSPACE_CHANNEL_IDS`。未展示的渠道也必须留在这里，否则历史绑定记录
 * 会显示成裸 id。
 */
export const OTA_CHANNELS: readonly OtaChannel[] = [
  {
    id: 'ctrip',
    name: '携程酒店 eBooking',
    shortName: '携程',
    url: 'https://ebooking.ctrip.com/',
    iconUrl: OTA_ICONS.ctrip,
  },
  {
    id: 'meituan',
    name: '美团酒店',
    shortName: '美团酒店',
    url:
      'https://me.meituan.com/login/index.html' +
      '?redirect=https%3A%2F%2Fme.meituan.com%2Febooking%2Fmerchant%2FebIframe%3FiUrl%3D' +
      '%252Febooking%252Fnew-workbench%252Findex.html%2523%252F',
    iconUrl: OTA_ICONS.meituan,
  },
  {
    id: 'meituan-minsu',
    name: '美团民宿',
    shortName: '美团民宿',
    url: 'https://minsu.meituan.com/',
    iconUrl: OTA_ICONS.meituan,
  },
  {
    id: 'fliggy',
    name: '飞猪酒店商家',
    shortName: '飞猪',
    url: 'https://hotel.fliggy.com/ebooking/hotelBaseInfoUv.htm',
    iconUrl: OTA_ICONS.fliggy,
  },
  {
    id: 'douyin',
    name: '抖音来客',
    shortName: '抖音来客',
    url: 'https://life.douyin.com/p/login',
    iconUrl: OTA_ICONS.douyin,
  },
  {
    id: 'xiaohongshu',
    name: '小红书本地生活',
    shortName: '小红书',
    url: 'https://merchant.xiaohongshu.com/',
    iconUrl: OTA_ICONS.xiaohongshu,
  },
  {
    id: 'tujia',
    name: '途家民宿',
    shortName: '途家',
    url: 'https://bj.tujia.com/seller/login',
    iconUrl: OTA_ICONS.tujia,
  },
  {
    id: 'booking',
    name: 'Booking.com',
    shortName: 'Booking.com',
    url: 'https://admin.booking.com/hotel/',
    iconUrl: OTA_ICONS.booking,
  },
  {
    id: 'agoda',
    name: 'Agoda',
    shortName: 'Agoda',
    url: 'https://ycs.agoda.com/',
    iconUrl: OTA_ICONS.agoda,
  },
  {
    id: 'expedia',
    name: 'Expedia',
    shortName: 'Expedia',
    url: 'https://partner.expedia.com/',
    iconUrl: OTA_ICONS.expedia,
  },
];
