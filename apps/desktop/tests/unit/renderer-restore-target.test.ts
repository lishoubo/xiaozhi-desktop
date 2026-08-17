import { describe, expect, it } from 'vitest';
import { pickRestoreTarget } from '../../src/renderer/components/browser/restore-target';
import type { BrowserTab } from '../../src/shared/browser';

function tab(id: string, channelId: string): BrowserTab {
  return {
    id,
    channelId,
    title: id,
    url: `https://${channelId}.example/`,
    canGoBack: false,
    canGoForward: false,
    loading: false,
    partitionName: `persist:xiaozhi:dev:${channelId}:${id}`,
  };
}

/**
 * 🔴 回归：挂载时原本固定去找携程（`OTA_CHANNELS[0]`）的标签页，导致两个真机现象——
 * 只开美团时内容区空白（一次 activate 都不发），携程+美团都开时总是跳回携程。
 */
describe('pickRestoreTarget', () => {
  const ctrip = tab('t-ctrip', 'ctrip');
  const meituan = tab('t-meituan', 'meituan');

  it('优先恢复上次激活的那个标签页', () => {
    expect(pickRestoreTarget([ctrip, meituan], 'meituan', 't-meituan')).toBe(meituan);
  });

  it('用户最后看美团时不会跳回携程 —— 即使携程标签还开着', () => {
    expect(pickRestoreTarget([ctrip, meituan], 'meituan', 't-meituan')?.channelId).toBe('meituan');
  });

  it('上次那个标签页已关闭时，退到同渠道的另一个', () => {
    const second = tab('t-meituan-2', 'meituan');
    expect(pickRestoreTarget([ctrip, second], 'meituan', 't-meituan-gone')).toBe(second);
  });

  it('该渠道一个都不剩时兜底到任意已打开的 —— 空白内容区比切走更糟', () => {
    expect(pickRestoreTarget([ctrip], 'meituan', 't-meituan')).toBe(ctrip);
  });

  it('只开了美团也能恢复 —— 原实现在这里一个 activate 都不发，内容区空白', () => {
    expect(pickRestoreTarget([meituan], 'meituan', 't-meituan')).toBe(meituan);
  });

  it('没有任何标签页时返回 undefined，调用方据此跳过激活', () => {
    expect(pickRestoreTarget([], 'ctrip', undefined)).toBeUndefined();
  });

  it('从未激活过任何标签页时（首次进入）仍给出一个目标', () => {
    expect(pickRestoreTarget([ctrip, meituan], 'ctrip', undefined)).toBe(ctrip);
  });
});
