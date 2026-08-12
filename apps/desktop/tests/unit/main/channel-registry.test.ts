/**
 * 「哪些渠道会被改价监听」是一个**有意的产品决定**，不是实现细节：
 *
 * - 携程 / 美团：业户在这些渠道后台改价，RMS 据此跟价 → 监听
 * - 抖音：它是**被跟价的那一端**，监听它等于把 RMS 自己写进去的价再报回 RMS
 *   （服务端也把 douyin 判为 `SOURCE_NOT_SUPPORTED`）→ 不监听
 *
 * 抖音适配器的代码和测试都还在，只是没注册。这条测试把「没注册」钉住 —— 否则将来
 * 有人顺手在 registry 里补一行，监听就悄悄打开了，而症状（自己追自己）在日志上
 * 很难一眼看出来。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  amountChangeAdapters,
  createChannelRegistry,
  hotelProbes,
  loginUrlMatchers,
} from '../../../src/main/channels/registry';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('createChannelRegistry', () => {
  it('三个渠道都注册了登录判定与酒店探测', () => {
    const registry = createChannelRegistry(createLogger());

    expect([...loginUrlMatchers(registry).keys()].sort()).toEqual(['ctrip', 'douyin', 'meituan']);
    expect([...hotelProbes(registry).keys()].sort()).toEqual(['ctrip', 'douyin', 'meituan']);
  });

  it('只有携程与美团参与改价监听 —— 抖音是被跟价端，刻意不注册', () => {
    const registry = createChannelRegistry(createLogger());

    expect([...amountChangeAdapters(registry).keys()].sort()).toEqual(['ctrip', 'meituan']);
  });
});
