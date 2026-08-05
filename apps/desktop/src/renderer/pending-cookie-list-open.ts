/**
 * 首次引导浮层（`BrowserWorkspace.svelte`，`/` 路由）导入 Cookie 完成后跳转到
 * 设置页（`/settings` 路由）查看导入结果，两者分属不同路由、没有共享的组件
 * 状态。这里存一条"待自动打开 Cookie 列表"意图，`SettingsPage.svelte` 挂载
 * 时读取并消费（读取即清空，避免下次挂载重复触发）。
 */
let pendingOpen = false;

export function requestCookieListAutoOpen(): void {
  pendingOpen = true;
}

export function consumeCookieListAutoOpen(): boolean {
  const value = pendingOpen;
  pendingOpen = false;
  return value;
}
