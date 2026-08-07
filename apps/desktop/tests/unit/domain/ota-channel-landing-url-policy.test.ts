import { describe, expect, it } from 'vitest';
import { toChannelId } from '../../../src/domain/identity';
import {
  otaChannelLandingUrl,
  UnsupportedChannelForLandingUrlError,
} from '../../../src/domain/policy/ota-channel-landing-url-policy';

describe('otaChannelLandingUrl', () => {
  it('携程场景：返回渠道默认 URL', () => {
    const url = otaChannelLandingUrl(toChannelId('ctrip'));
    expect(url).toBe('https://ebooking.ctrip.com/home/mainland');
  });

  it('抖音场景：返回渠道默认 URL', () => {
    const url = otaChannelLandingUrl(toChannelId('douyin'));
    expect(url).toBe('https://life.douyin.com/p/home');
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
