import { describe, expect, it } from 'vitest';
import { toChannelId } from '../../../src/domain/identity';
import {
  otaAccountLandingUrl,
  UnsupportedChannelForLandingUrlError,
} from '../../../src/domain/policy/ota-account-landing-url-policy';

describe('otaAccountLandingUrl', () => {
  it('抖音场景：bindExtra 含 groupid 时拼出门店首页', () => {
    const url = otaAccountLandingUrl({
      channel: toChannelId('douyin'),
      bindExtra: { merchantGroupId: 'group-1' },
    });
    expect(url).toBe('https://life.douyin.com/p/home?groupid=group-1');
  });

  it('携程场景：bindExtra 恒为 null，返回渠道默认 URL', () => {
    const url = otaAccountLandingUrl({ channel: toChannelId('ctrip'), bindExtra: null });
    expect(url).toBe('https://ebooking.ctrip.com/home/mainland');
  });

  it('抖音场景：bindExtra 缺失时退化到不带 groupid 的登录后台首页，不报错', () => {
    const url = otaAccountLandingUrl({ channel: toChannelId('douyin'), bindExtra: null });
    expect(url).toBe('https://life.douyin.com/p/home');
  });

  it('未知渠道且无默认 URL 时抛错', () => {
    expect(() =>
      otaAccountLandingUrl({ channel: toChannelId('meituan-hotel'), bindExtra: null }),
    ).toThrow(UnsupportedChannelForLandingUrlError);
  });
});
