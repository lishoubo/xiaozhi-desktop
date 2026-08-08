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
  /** 浏览器工作区用它开标签页——开 tab 的三步收尾只有渲染进程做得了。 */
  credentialId: string;
  rmsHotelId: number;
  rmsHotelName: string;
}>();
