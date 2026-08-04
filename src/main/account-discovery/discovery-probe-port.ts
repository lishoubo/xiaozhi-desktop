/**
 * 账号探测层的接口 —— 「拿到一份渠道登录态」到「知道这份登录态管哪些门店」。
 * 实现在本目录下，按渠道各自封装 URL、分页、字段映射。
 * 见 `openspec/changes/cookie-login-account-discovery/design.md` 决策 2、5。
 *
 * 放在 main/ 而非 domain/：`discover()` 需要接收登录标签页本身的
 * `WebContents` 引用（部分渠道如抖音要在这个真实、已登录的可见标签页上
 * 直接读数据/模拟点击，而不是新开页面重新走一遍登录态），这是 Electron
 * 相关的概念，不满足 domain 层零框架依赖的约束。
 */
import type { WebContents } from 'electron';
import type { ChannelId, OtaHotelId } from '../../domain/identity';

export type DiscoveredOtaHotel = Readonly<{
  otaHotelId: OtaHotelId;
  otaHotelName: string;
  /** 渠道特定的免登录跳转上下文，抖音存 groupid；携程恒为 null。见 douyin-multi-account-nav/design.md §2.1。 */
  channelContext: string | null;
}>;

export type DiscoveryOutcome =
  | Readonly<{ kind: 'unsupported' }>
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'single'; hotel: DiscoveredOtaHotel }>
  | Readonly<{ kind: 'multiple'; hotels: readonly DiscoveredOtaHotel[] }>;

export interface DiscoveryProbe {
  readonly channel: ChannelId;
  /**
   * `landingUrl` 是登录标签页 URL 判定命中登录成功时的完整 URL（见
   * design.md 决策 8）——部分渠道（如抖音）的门店身份参数（groupid）由
   * 用户在登录标签页交互中产生、只存在于这个 URL 里，不在 cookie 里。
   * `webContents` 是这个登录标签页本身（用户可见）的引用——需要直接在
   * 这个已经落在正确页面的真实标签页上操作的渠道（如抖音）用它；不需要
   * 的渠道（如携程，cookie 本身已包含全部所需信息，新开隐藏页面重新
   * 导航即可）忽略它。
   */
  discover(partitionName: string, landingUrl: string, webContents: WebContents): Promise<DiscoveryOutcome>;
}
