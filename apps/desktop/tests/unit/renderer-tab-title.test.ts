import { describe, expect, it } from 'vitest';
import { displayTabTitle } from '../../src/renderer/components/browser/tab-title';
import type { BrowserTab } from '../../src/shared/browser';

function tab(overrides: Partial<BrowserTab> = {}): BrowserTab {
  return {
    id: 'tab-1',
    channelId: 'ctrip',
    title: '订单管理',
    url: 'https://ebooking.ctrip.com/',
    canGoBack: false,
    canGoForward: false,
    loading: false,
    partitionName: 'persist:xiaozhi:dev:ctrip:abcd1234',
    failure: null,
    ...overrides,
  };
}

describe('displayTabTitle', () => {
  it('strips the channel suffix so truncated tabs stay distinguishable', () => {
    expect(displayTabTitle(tab({ title: '订单管理 - 携程酒店eBooking' }))).toBe('订单管理');
    expect(displayTabTitle(tab({ channelId: 'meituan', title: '房态日历 | 美团酒店商家中心' }))).toBe(
      '房态日历',
    );
  });

  it('keeps the original title when the channel has no suffix rule', () => {
    expect(displayTabTitle(tab({ channelId: 'fliggy', title: '飞猪商家 - 某某页' }))).toBe(
      '飞猪商家 - 某某页',
    );
  });

  /**
   * 渠道首页的标题常常整个就是后缀本身。清成空字符串的话标签是一片空白，
   * 比留着后缀更难认。
   */
  it('falls back to the raw title when stripping would empty it', () => {
    expect(displayTabTitle(tab({ title: '- 携程酒店eBooking' }))).toBe('- 携程酒店eBooking');
  });

  it('shows a placeholder while the title is still empty', () => {
    expect(displayTabTitle(tab({ title: '' }))).toBe('正在加载…');
    expect(displayTabTitle(tab({ title: '   ' }))).toBe('正在加载…');
  });

  /**
   * 🔴 故障态优先于标题：页面崩了还显示崩溃前的标题，用户无从判断自己在看什么。
   */
  it('reports the failure instead of the stale title', () => {
    expect(displayTabTitle(tab({ failure: 'crashed', title: '订单管理' }))).toBe('页面已崩溃');
    expect(displayTabTitle(tab({ failure: 'load-failed' }))).toBe('页面加载失败');
    expect(displayTabTitle(tab({ failure: 'unresponsive' }))).toBe('页面无响应');
  });
});
