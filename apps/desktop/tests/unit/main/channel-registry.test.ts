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
  inventoryReadbacks,
  loginUrlMatchers,
} from '../../../src/main/channels/registry';
import { DEFAULT_APP_CONFIG } from '../../../src/main/app-config/defaults';
import { toChannelId } from '../../../src/main/ids';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function createRegistry() {
  return createChannelRegistry(createLogger(), () => DEFAULT_APP_CONFIG);
}

describe('createChannelRegistry', () => {
  /**
   * 🔴 内部页面（小智平台）**不是渠道**，绝不能出现在注册表里。
   *
   * 登录判定、门店探测、改价监听三者都以本注册表投影出的 Map 为准，查不到就直接
   * return —— 「不注册」正是内部页面不挂载这些 OTA 流程的**唯一**机制，没有别的
   * 开关兜底。有人顺手在这里补一行 `xiaozhi`，内部页面就会被当成 OTA 渠道做登录
   * 判定与门店探测，而症状只会表现为一些莫名其妙的探测日志。
   */
  it('内部页面 xiaozhi 未被注册为渠道', () => {
    const registry = createRegistry();

    expect(registry.has(toChannelId('xiaozhi'))).toBe(false);
    expect([...loginUrlMatchers(registry).keys()]).not.toContain('xiaozhi');
    expect([...hotelProbes(registry).keys()]).not.toContain('xiaozhi');
    expect([...amountChangeAdapters(registry).keys()]).not.toContain('xiaozhi');
    expect([...inventoryReadbacks(registry).keys()]).not.toContain('xiaozhi');
  });

  it('三个渠道都注册了登录判定与酒店探测', () => {
    const registry = createRegistry();

    expect([...loginUrlMatchers(registry).keys()].sort()).toEqual(['ctrip', 'douyin', 'meituan']);
    expect([...hotelProbes(registry).keys()].sort()).toEqual(['ctrip', 'douyin', 'meituan']);
  });

  it('只有携程与美团参与改价监听 —— 抖音是被跟价端，刻意不注册', () => {
    const registry = createRegistry();

    expect([...amountChangeAdapters(registry).keys()].sort()).toEqual(['ctrip', 'meituan']);
  });

  /**
   * 房量回读：携程与美团已实装。
   *
   * 抖音是被跟价的那一端，回读它没有意义（与改价监听不注册它同一理由）。
   */
  it('携程与美团注册了房量回读，抖音没有', () => {
    const registry = createRegistry();

    expect([...inventoryReadbacks(registry).keys()].sort()).toEqual(['ctrip', 'meituan']);
    expect([...inventoryReadbacks(registry).keys()]).not.toContain('douyin');
  });
});
