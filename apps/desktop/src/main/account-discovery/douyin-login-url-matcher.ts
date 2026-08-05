/**
 * 抖音来客登录页 URL 判据——落地页需命中 `/p/home` 且带 `groupid` 查询参数才视为
 * 登录成功（用户在登录标签页里已经手动选完公司/门店）。
 * 判据依据：RPA 脚本 `is_logged_in_url`/`go_home` 的落地页约定——单门店账号登录后
 * 直接带 groupid 跳到 `/p/home?groupid=...`，多门店账号会先停在 `/p/login` 的选公司
 * 页面，用户选完公司后才会落到同样带 groupid 的 `/p/home`：
 * rms-rpa-worker/rms_rpa_worker/adapters/douyin/session.py:81-90。
 * 只判 `/p/home` 不判 groupid 会在"停在选公司页"这个中间态误判为已登录。
 */
import type { LoginUrlMatcher } from '../../domain/ports/discovery';
import { toChannelId } from '../../domain/identity';

const HOME_PATH = '/p/home';
const GROUP_ID_PARAM = 'groupid';

export const douyinLoginUrlMatcher: LoginUrlMatcher = {
  channel: toChannelId('douyin'),
  isPastLogin(url: string): boolean {
    if (!url.includes(HOME_PATH)) return false;
    try {
      return new URL(url).searchParams.get(GROUP_ID_PARAM) !== null;
    } catch {
      return false;
    }
  },
};
