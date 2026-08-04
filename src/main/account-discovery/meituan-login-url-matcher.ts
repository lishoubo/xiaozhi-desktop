/**
 * 美团登录页 URL 判据——命中白名单关键字才算登录成功，不是简单"离开 /login/"。
 * 判据抄自已实测验证过的 RPA 实现：
 * rms-rpa-worker/rms_rpa_worker/ota/step/meituan/selectors.py:44-48
 * （注释明确写了"勿用 /new-workbench/ alone，避免 eb 文档未换票就判成功"）。
 * 见 design-meituan.md 决策 11。
 */
import type { LoginUrlMatcher } from '../../domain/ports/discovery';
import { toChannelId } from '../../domain/identity';

const LOGIN_SUCCESS_URL_KEYWORDS = ['/ebooking/merchant/ebIframe', '/ebooking/index.html'];

export const meituanLoginUrlMatcher: LoginUrlMatcher = {
  channel: toChannelId('meituan'),
  isPastLogin(url: string): boolean {
    return LOGIN_SUCCESS_URL_KEYWORDS.some((keyword) => url.includes(keyword));
  },
};
