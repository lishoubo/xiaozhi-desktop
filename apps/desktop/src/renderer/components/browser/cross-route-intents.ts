import type { BrowserTab } from '../../../shared/browser';
import { createNavigationIntent } from '../../navigation-intent';

/**
 * 首次引导浮层（`BrowserWorkspace.svelte`，`/` 路由）导入 Cookie 完成后跳转到
 * 设置页（`/settings` 路由）查看导入结果，请求 `CookieLoginListDialog` 挂载时
 * 自动展开 Cookie 列表。
 */
export const cookieListAutoOpen = createNavigationIntent<true>();

/**
 * 设置页「已登录 Cookie 列表」用 Cookie 开出标签页后跳回浏览器工作区
 * （`/` 路由），请求 `BrowserWorkspace` 挂载时激活该标签。
 */
export const tabActivation = createNavigationIntent<BrowserTab>();
