import { describe, expect, it } from 'vitest';
import { AppConfigStore } from '../../../src/main/app-config/app-config-store';
import { DEFAULT_APP_CONFIG } from '../../../src/main/app-config/defaults';
import type { AppConfigSource, PartialAppConfig } from '../../../src/main/app-config/types';

function source(patch: PartialAppConfig | null): AppConfigSource {
  return { read: () => patch };
}

describe('AppConfigStore', () => {
  it('没有任何覆盖来源时取内置默认值', () => {
    expect(new AppConfigStore().get()).toEqual(DEFAULT_APP_CONFIG);
  });

  it('第一期的 delayMs 默认是 0（不延迟）', () => {
    // 这个值是「留位」而非经验值，改动它等于改变第一期的既定行为 —— 见 types.ts。
    expect(new AppConfigStore().get().ctripInventoryReadback.delayMs).toBe(0);
  });

  // ⭐ 本文件最重要的一条：浅合并会让同组其余键整组消失，而类型上看不出来
  // （Partial 允许缺键），只在运行期炸。
  it('某一层只覆盖组内部分键时，未覆盖的键仍取下层的值', () => {
    const store = new AppConfigStore([source({ ctripInventoryReadback: { delayMs: 3000 } })]);

    const config = store.get();
    expect(config.ctripInventoryReadback.delayMs).toBe(3000);
    expect(config.ctripInventoryReadback.windowDays).toBe(
      DEFAULT_APP_CONFIG.ctripInventoryReadback.windowDays,
    );
    expect(config.ctripInventoryReadback.timeoutMs).toBe(
      DEFAULT_APP_CONFIG.ctripInventoryReadback.timeoutMs,
    );
  });

  it('多层覆盖时后面的层优先', () => {
    const store = new AppConfigStore([
      source({ ctripInventoryReadback: { delayMs: 1000, windowDays: 14 } }),
      source({ ctripInventoryReadback: { delayMs: 5000 } }),
    ]);

    const config = store.get();
    expect(config.ctripInventoryReadback.delayMs).toBe(5000);
    // 高优先级层没提的键，保留低优先级层的覆盖，而不是回落到默认值。
    expect(config.ctripInventoryReadback.windowDays).toBe(14);
  });

  it('来源返回 null 表示这层没有意见，不影响结果', () => {
    const store = new AppConfigStore([
      source({ ctripInventoryReadback: { windowDays: 14 } }),
      source(null),
    ]);

    expect(store.get().ctripInventoryReadback.windowDays).toBe(14);
  });

  it('来源返回空对象时不改变任何值', () => {
    expect(new AppConfigStore([source({})]).get()).toEqual(DEFAULT_APP_CONFIG);
  });

  it('运行中来源的值变化能被下一次 get 读到', () => {
    // 不缓存合并结果的理由：将来服务端下发会在运行中变，缓存会让下发后仍用旧值。
    let patch: PartialAppConfig = { ctripInventoryReadback: { delayMs: 1000 } };
    const store = new AppConfigStore([{ read: () => patch }]);

    expect(store.get().ctripInventoryReadback.delayMs).toBe(1000);
    patch = { ctripInventoryReadback: { delayMs: 2000 } };
    expect(store.get().ctripInventoryReadback.delayMs).toBe(2000);
  });
});

describe('inventoryScan', () => {
  it('默认值可用', () => {
    const config = new AppConfigStore().get();
    expect(config.inventoryScan.window).toEqual({ kind: 'days', days: 7 });
    expect(config.inventoryScan.timeoutMs).toBe(30_000);
  });

  it('部分覆盖时同组未覆盖项保持默认', () => {
    const config = new AppConfigStore([
      { read: () => ({ inventoryScan: { timeoutMs: 5_000 } }) },
    ]).get();
    expect(config.inventoryScan.timeoutMs).toBe(5_000);
    // ⚠️ 浅合并会把 window 抹成 undefined —— 这条守住 mergeConfig 的深合并。
    expect(config.inventoryScan.window).toEqual({ kind: 'days', days: 7 });
  });

  // ⚠️ 守住「联合/数组是整体替换，不是逐元素合并」的约定，见 types.ts 的 PartialAppConfig。
  it('window 是整体替换，不与默认值合并', () => {
    const config = new AppConfigStore([
      { read: () => ({ inventoryScan: { window: { kind: 'days', days: 30 } } }) },
    ]).get();
    expect(config.inventoryScan.window).toEqual({ kind: 'days', days: 30 });
  });

  it('加了新配置组后既有组不受影响', () => {
    const config = new AppConfigStore([
      { read: () => ({ inventoryScan: { timeoutMs: 1 } }) },
    ]).get();
    expect(config.ctripInventoryReadback.windowDays).toBe(7);
    expect(config.meituanInventoryReadback.timeoutMs).toBe(30_000);
  });
});
