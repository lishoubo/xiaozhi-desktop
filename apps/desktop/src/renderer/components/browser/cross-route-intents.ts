import type { BrowserTab } from '../../../shared/browser';
import { createNavigationIntent } from '../../navigation-intent';

/**
 * 渠道账号弹窗用 Cookie 开出标签页后跳回浏览器工作区（`/` 路由），
 * 请求 `BrowserWorkspace` 挂载时激活该标签。
 */
export const tabActivation = createNavigationIntent<BrowserTab>();
