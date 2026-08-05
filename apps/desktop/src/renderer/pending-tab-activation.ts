/**
 * 设置页"已登录 Cookie 列表"与浏览器工作区分属两个路由页面
 * （svelte-spa-router 卸载/重建组件树），没有共享的组件状态。这里存一条
 * "待激活标签"意图，跳转到浏览器页后由 `BrowserWorkspace` 在挂载时读取
 * 并消费（读取即清空，避免下次挂载重复触发）。
 */
import type { BrowserTab } from '../shared/browser';

let pendingTab: BrowserTab | undefined;

export function setPendingTabActivation(tab: BrowserTab): void {
  pendingTab = tab;
}

export function consumePendingTabActivation(): BrowserTab | undefined {
  const tab = pendingTab;
  pendingTab = undefined;
  return tab;
}
