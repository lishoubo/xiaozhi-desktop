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
  /**
   * 非空表示这是一次**修复**：这条远端绑定没有 `otaHotelId`，用户重新选定门店后走
   * `confirmBackfillHotel`（`PUT /ota-accounts/{id}`）把门店补上，而不是
   * `confirmBinding` 新建一条 —— 后者会被「已存在活跃绑定」拒，挡住的正是要修的这条。
   *
   * 前半段（开标签页、登录、探测、选门店）与新增绑定完全一致，所以复用同一条意图
   * 与同一个弹窗，只在收尾时分流。
   */
  backfillOtaAccountId?: number;
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

/**
 * 「按门店重认」的跨路由意图 —— RMS 后台绑定的老记录专用。
 *
 * 那些记录的 `bindExtra` 里没有渠道账号标识，认不出该登录哪个账号，`otaReauthWaiting`
 * 要求的 `expectedChannelAccountId` 根本拿不到。改用门店当锚点：登录成功后探测该账号
 * 能管哪些门店，`expectedOtaHotelId` 在里面才算通过。
 *
 * ⚠️ **不要走 `hotelBindingWaiting`**：那条路会让用户重选门店并写一条新绑定，而这里
 * 要的是门店关系原封不动，只换登录态。两者形似而语义相反。
 *
 * 与另外两条意图一样二选一起点：`credentialId` 是「用已有账号试试」，`newLoginChannel`
 * 是「新登录一个账号」。核对逻辑相同，都由 `reauth-by-hotel` intent 在主进程完成。
 */
export const otaReauthByHotelWaiting = createNavigationIntent<{
  requestId: string;
  credentialId?: string;
  newLoginChannel?: { channelId: string; url: string };
  otaAccountId: number;
  expectedOtaHotelId: string;
  /** 渠道 id —— 抖音要据此换一条开 tab 的路，见 `ReauthDialog` 的说明。 */
  channelId: string;
  channelName: string;
  rmsHotelName: string;
}>();
