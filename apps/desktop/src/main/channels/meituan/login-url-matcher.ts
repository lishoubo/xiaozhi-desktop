/**
 * 美团登录页 URL 判据。仅命中已验证的 ebooking 入口才视为登录成功，避免页面尚未换票时
 * 提前触发账号发现。
 */
import { toChannelId } from '../../ids';
import type { LoginUrlMatcher } from '../types';

const LOGIN_SUCCESS_URL_KEYWORDS = ['/ebooking/merchant/ebIframe', '/ebooking/index.html'];

export const meituanLoginUrlMatcher: LoginUrlMatcher = {
  channel: toChannelId('meituan'),
  isPastLogin(url: string): boolean {
    return LOGIN_SUCCESS_URL_KEYWORDS.some((keyword) => url.includes(keyword));
  },
};
