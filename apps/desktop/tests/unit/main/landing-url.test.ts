import { describe, expect, it } from 'vitest';
import { toChannelId } from '../../../src/main/ids';
import {
  otaChannelLandingUrl,
  UnsupportedChannelForLandingUrlError,
} from '../../../src/main/channels/landing-url';
import { ctripLoginUrlMatcher } from '../../../src/main/channels/ctrip/login-url-matcher';
import { douyinLoginUrlMatcher } from '../../../src/main/channels/douyin/login-url-matcher';
import { meituanLoginUrlMatcher } from '../../../src/main/channels/meituan/login-url-matcher';

describe('otaChannelLandingUrl', () => {
  it('携程场景：返回渠道默认 URL', () => {
    const url = otaChannelLandingUrl(toChannelId('ctrip'));
    expect(url).toBe('https://ebooking.ctrip.com/home/mainland');
  });

  /**
   * 抖音落的是登录页：`groupid` 只有抖音登录后才给，我们拼不出来，所以让它自己
   * 重定向。写死 `/p/home` 会得到一个判据永不命中的地址（见下一个用例）。
   */
  it('抖音场景：返回登录页而非 /p/home', () => {
    const url = otaChannelLandingUrl(toChannelId('douyin'));
    expect(url).toBe('https://life.douyin.com/p/login');
  });

  it('美团场景：返回渠道默认 URL', () => {
    const url = otaChannelLandingUrl(toChannelId('meituan'));
    expect(url).toContain('https://me.meituan.com/ebooking/merchant/ebIframe');
  });

  it('未知渠道且无默认 URL 时抛错', () => {
    expect(() => otaChannelLandingUrl(toChannelId('meituan-hotel'))).toThrow(
      UnsupportedChannelForLandingUrlError,
    );
  });
});

/**
 * 落地页与登录判据必须对得上，否则打开已有账号会静默卡死：判定停在
 * `not-yet-past-login` → 门店探测从不触发 → 绑定流程等不到候选。
 *
 * 携程/美团的落地页**本身**就已过登录，直接命中；抖音相反，落地页是登录页、**不该**
 * 命中——它靠抖音重定向到带 `groupid` 的地址才算过。两种期望都钉住，防止有人"顺手"
 * 把抖音改回 `/p/home`（那个 URL 看着像已登录，判据上却永远不通过）。
 */
describe('落地页与登录判据的对应关系', () => {
  it.each([
    ['ctrip', ctripLoginUrlMatcher],
    ['meituan', meituanLoginUrlMatcher],
  ])('%s：落地页本身即已过登录', (channel, matcher) => {
    expect(matcher.isPastLogin(otaChannelLandingUrl(toChannelId(channel)))).toBe(true);
  });

  it('抖音：落地页是登录页，等抖音重定向出 groupid 才算过', () => {
    const landingUrl = otaChannelLandingUrl(toChannelId('douyin'));
    expect(douyinLoginUrlMatcher.isPastLogin(landingUrl)).toBe(false);
    expect(douyinLoginUrlMatcher.isPastLogin('https://life.douyin.com/p/home?groupid=7')).toBe(
      true,
    );
  });
});
