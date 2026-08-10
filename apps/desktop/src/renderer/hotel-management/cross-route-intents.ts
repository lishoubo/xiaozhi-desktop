import { createNavigationIntent } from '../navigation-intent';

/**
 * 酒店管理页（`/hotels`）点「新增绑定账号」后跳到浏览器工作区（`/` 路由）：
 * 发起在酒店这边（用户从「这家酒店要绑账号」出发），候选弹窗在浏览器那边
 * （否决后要能立刻换渠道重试，跳回来会把这个循环拆成往返）。
 *
 * 这里存一条「待等待的绑定结果」意图，`BrowserWorkspace` 挂载时读取并消费。
 */
export const hotelBindingWaiting = createNavigationIntent<{
  requestId: string;
  /**
   * 浏览器工作区用它开标签页——开 tab 的三步收尾只有渲染进程做得了。
   *
   * 二选一：`credentialId` 是「用已有账号」，`newLoginChannel` 是「新登录账号」
   * （此刻还没有凭证，登录成功后才会产生）。
   */
  credentialId?: string;
  newLoginChannel?: { channelId: string; url: string };
  rmsHotelId: number;
  rmsHotelName: string;
  /**
   * 从「重新登录」里点新登录账号时带上：该酒店在这个渠道**已有**绑定，绑的是这家
   * OTA 门店。新账号探测出的门店与它不一致时不能直接绑——远端只允许一个活跃绑定，
   * 提交必被拒。带上它是为了在确认前就说清楚，而不是让用户走完全程再失败。
   */
  replacingOtaHotelId?: string | null;
}>();

/**
 * 「重新登录」的跨路由意图。与绑定同一形状：酒店页发起，浏览器工作区接手开标签页
 * 并等结果。
 *
 * `expectedChannelAccountId` 一路带到主进程做身份核对——用户选的是「恢复这个账号」，
 * 登录出来的必须还是它。
 */
export const otaReauthWaiting = createNavigationIntent<{
  requestId: string;
  credentialId: string;
  expectedChannelAccountId: string;
  otaAccountId: number;
  channelName: string;
}>();
