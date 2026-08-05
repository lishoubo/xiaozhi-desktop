import { describe, expect, it } from 'vitest';
import {
  channelForCookieDomain,
  chromiumTimestampToUnix,
  friendlyCookieImportMessage,
  isSupportedCookieDomain,
} from '../../../../src/main/cookie-import/cookie-import';

describe('automatic browser cookie import', () => {
  it('only accepts cookie domains used by supported OTA platforms', () => {
    expect(isSupportedCookieDomain('.ebooking.ctrip.com')).toBe(true);
    expect(isSupportedCookieDomain('.unrelated.example')).toBe(false);
  });

  it('不在本次最小映射表里的域名（如淘宝、booking）不再被当作受支持渠道', () => {
    expect(isSupportedCookieDomain('login.taobao.com')).toBe(false);
    expect(isSupportedCookieDomain('admin.booking.com')).toBe(false);
  });

  it('按域名归类到具体渠道，用于把导入结果按渠道拆分', () => {
    expect(channelForCookieDomain('.life.douyin.com')).toBe('douyin');
    expect(channelForCookieDomain('.ebooking.ctrip.com')).toBe('ctrip');
    expect(channelForCookieDomain('.ebooking.meituan.com')).toBe('meituan');
    expect(channelForCookieDomain('.unrelated.example')).toBeNull();
  });

  it('converts Chromium microseconds since 1601 to Unix seconds', () => {
    expect(chromiumTimestampToUnix(13_344_473_600_000_000)).toBe(1_700_000_000);
    expect(chromiumTimestampToUnix(0)).toBeUndefined();
  });

  it('turns system and browser errors into short Chinese messages', () => {
    expect(friendlyCookieImportMessage(new Error('没有找到 Safari Cookie 数据'))).toBe(
      '没有找到可导入的 Cookie',
    );
    expect(friendlyCookieImportMessage(new Error('User interaction is not allowed'))).toBe(
      '无法读取浏览器 Cookie，请允许访问后重试',
    );
    expect(friendlyCookieImportMessage(new Error('Windows 应用绑定加密'))).toBe(
      '该浏览器暂不支持自动导入，请尝试其他浏览器',
    );
    expect(friendlyCookieImportMessage(new Error('SQLITE_CORRUPT details'))).toBe(
      'Cookie 导入失败，请稍后重试',
    );
  });
});
