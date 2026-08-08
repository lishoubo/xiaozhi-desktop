/**
 * 携程登录页 URL 判据——只要 URL 不再包含 `/login/` 即视为跳出登录页（登录成功）。
 * 不同账号状态跳转目标不同（已入驻 `/hotel/{id}`、未入驻 `/hotelSignUp/...`），
 * 判据抄自已实测验证过的 RPA 实现：
 * rms-rpa-worker/rms_rpa_worker/adapters/ctrip/login.py:30。
 */
import type { LoginUrlMatcher } from '../../../../../domain/ports/discovery';
import { toChannelId } from '../../../../../domain/identity';

const LOGIN_URL_KEYWORD = '/login/';

export const ctripLoginUrlMatcher: LoginUrlMatcher = {
  channel: toChannelId('ctrip'),
  isPastLogin(url: string): boolean {
    return !url.includes(LOGIN_URL_KEYWORD);
  },
};
