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
  /**
   * 后缀规则表当前**刻意为空**（等真机实测的 document.title 再补，理由见
   * `tab-title.ts`）。规则为空时必须原样返回——绝不能因为查不到规则就吞标题。
   */
  it('returns the title unchanged while no suffix rule is configured', () => {
    expect(displayTabTitle(tab({ title: '订单管理 - 携程酒店eBooking' }))).toBe(
      '订单管理 - 携程酒店eBooking',
    );
    expect(displayTabTitle(tab({ channelId: 'fliggy', title: '飞猪商家 - 某某页' }))).toBe(
      '飞猪商家 - 某某页',
    );
  });

  it('trims surrounding whitespace', () => {
    expect(displayTabTitle(tab({ title: '  订单管理  ' }))).toBe('订单管理');
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
