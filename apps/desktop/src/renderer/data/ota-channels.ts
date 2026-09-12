import { SHOW_XIAOZHI_CHANNEL } from '../build-features';
import { OTA_ICONS } from './ota-icons';

export type OtaChannel = Readonly<{
  id: string;
  name: string;
  shortName: string;
  /**
   * 渠道后台的落地地址。**内部页面没有这个字段** —— 它的 URL 由主进程拼（要带
   * 访问令牌），渲染进程从来不持有令牌，也就不该持有那个地址。
   */
  url?: string;
  iconUrl: string;
  /**
   * `'ota'`  外部渠道商家后台：有账号、要登录、参与绑定与改价监听
   * `'internal'` 我们自己的 RMS 页面：无账号概念，点开即用
   *
   * 这个字段决定点击行为与它出现在哪些列表里，不只是个标签 —— 见
   * `WORKSPACE_CHANNEL_IDS` 与 `BINDABLE_CHANNEL_IDS` 的说明。
   */
  kind: 'ota' | 'internal';
}>;

/**
 * 一个确定有落地地址的 OTA 渠道。
 *
 * `OtaChannel.url` 是可选的（内部页面没有它，其 URL 由主进程拼），但绑定、重认、
 * 新建登录这些流程**只作用于 OTA 渠道**，那里 url 必然存在。用这个窄类型把
 * "这条路只走 OTA" 这件事交给类型系统，而不是在每个调用点写非空断言。
 */
export type OtaChannelWithUrl = OtaChannel & Readonly<{ url: string }>;

/** 判定一个条目是不是可登录的 OTA 渠道（内部页面会被排除）。 */
export function isOtaChannelWithUrl(channel: OtaChannel): channel is OtaChannelWithUrl {
  return channel.kind === 'ota' && typeof channel.url === 'string';
}

/**
 * 支持酒店绑定的渠道 —— 与主进程 `channels/registry.ts` 注册了 `hotelProbe` 的那三个
 * 一致。没有 probe 的渠道登录后探测不出候选，绑定流程走不完，因此绑定入口不能列出它们。
 *
 * ⚠ 主进程新增渠道适配器时要同步这里。两处分处不同进程，无法用类型系统关联。
 *
 * `kind: 'internal'` 的条目**永远不进这个数组**：内部页面没有渠道账号可绑。
 */
export const BINDABLE_CHANNEL_IDS: readonly string[] = ['ctrip', 'douyin', 'meituan'];

/**
 * 浏览器工作区顶部展示哪些渠道入口。
 *
 * OTA 渠道只留已经接通改价/房态监听与账号探测的那三个：入口太多会让工作区顶部拥挤，
 * 而其余渠道点进去也只是个空浏览器——既探测不出账号，也不上报任何改动，对用户没有价值。
 *
 * 首位的 `xiaozhi` 是内部页面（`kind: 'internal'`），不受上述判断约束——它是日常改价的
 * 主入口，点开即用。它还**暂不进正式包**：`SHOW_XIAOZHI_CHANNEL` 是编译期常量，
 * online 构建里这一项根本不进数组（规则与 AI 助理、运营日历同源，见
 * `build-features.ts`）。摘掉它之后首位自然落到 `ctrip`，默认激活渠道随之改变
 * ——`browser-ota-tabs.svelte.ts` 取的正是 `WORKSPACE_CHANNEL_IDS[0]`。
 *
 * ⚠️ **不是从 `OTA_CHANNELS` 里删条目**：`account.source` 是远端存下来的历史数据，各处
 * 都用 `OTA_CHANNELS.find()` 把它翻译成中文名（酒店卡片、重认弹窗、cookie 列表）。删了
 * 定义，那些记录就会退化成显示 `fliggy` 这样的裸 id。定义留着，只控制入口是否展示。
 *
 * 恢复某个渠道时把它加回这个数组即可；`OTA_CHANNELS` 里的定义一直都在。
 */
export const WORKSPACE_CHANNEL_IDS: readonly string[] = [
  ...(SHOW_XIAOZHI_CHANNEL ? (['xiaozhi'] as const) : []),
  'ctrip',
  'meituan',
  'douyin',
];

/**
 * 全部渠道定义。**这里是「id → 展示信息」的字典，不是「展示哪些入口」的清单**
 * —— 后者见 `WORKSPACE_CHANNEL_IDS`。未展示的渠道也必须留在这里，否则历史绑定记录
 * 会显示成裸 id。
 */
export const OTA_CHANNELS: readonly OtaChannel[] = [
  {
    /**
     * 小智平台自己的统一改价页 —— **不是 OTA**。放在首位是因为它是日常改价的主入口，
     * 其余三个是"去渠道后台看看"的次要入口。
     *
     * 它必须留在本字典里：`activeChannel` 靠 `OTA_CHANNELS.find()` 求得，缺了它工作区
     * 右上角会显示"未选择渠道"。但 `kind: 'internal'` 保证它不会混进账号绑定、
     * cookie 导入、历史绑定记录反查那些**只该列 OTA** 的地方。
     */
    id: 'xiaozhi',
    name: '小智平台',
    shortName: '小智平台',
    iconUrl: OTA_ICONS.xiaozhi,
    kind: 'internal',
  },
  {
    id: 'ctrip',
    name: '携程酒店 eBooking',
    shortName: '携程',
    url: 'https://ebooking.ctrip.com/',
    iconUrl: OTA_ICONS.ctrip,
    kind: 'ota',
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
    kind: 'ota',
  },
  {
    id: 'meituan-minsu',
    name: '美团民宿',
    shortName: '美团民宿',
    url: 'https://minsu.meituan.com/',
    iconUrl: OTA_ICONS.meituan,
    kind: 'ota',
  },
  {
    id: 'fliggy',
    name: '飞猪酒店商家',
    shortName: '飞猪',
    url: 'https://hotel.fliggy.com/ebooking/hotelBaseInfoUv.htm',
    iconUrl: OTA_ICONS.fliggy,
    kind: 'ota',
  },
  {
    id: 'douyin',
    name: '抖音来客',
    shortName: '抖音来客',
    url: 'https://life.douyin.com/p/login',
    iconUrl: OTA_ICONS.douyin,
    kind: 'ota',
  },
  {
    id: 'xiaohongshu',
    name: '小红书本地生活',
    shortName: '小红书',
    url: 'https://merchant.xiaohongshu.com/',
    iconUrl: OTA_ICONS.xiaohongshu,
    kind: 'ota',
  },
  {
    id: 'tujia',
    name: '途家民宿',
    shortName: '途家',
    url: 'https://bj.tujia.com/seller/login',
    iconUrl: OTA_ICONS.tujia,
    kind: 'ota',
  },
  {
    id: 'booking',
    name: 'Booking.com',
    shortName: 'Booking.com',
    url: 'https://admin.booking.com/hotel/',
    iconUrl: OTA_ICONS.booking,
    kind: 'ota',
  },
  {
    id: 'agoda',
    name: 'Agoda',
    shortName: 'Agoda',
    url: 'https://ycs.agoda.com/',
    iconUrl: OTA_ICONS.agoda,
    kind: 'ota',
  },
  {
    id: 'expedia',
    name: 'Expedia',
    shortName: 'Expedia',
    url: 'https://partner.expedia.com/',
    iconUrl: OTA_ICONS.expedia,
    kind: 'ota',
  },
];
