import { describe, expect, it } from 'vitest';
import { AppConfigStore } from '../../../src/main/app-config/app-config-store';
import { APP_ENVIRONMENT } from '../../../src/shared/app-environment';
import { DEFAULT_APP_CONFIG } from '../../../src/main/app-config/defaults';
import type { AppConfigSource, PartialAppConfig } from '../../../src/main/app-config/types';

function source(patch: PartialAppConfig | null): AppConfigSource {
  return { read: () => patch };
}

describe('AppConfigStore', () => {
  it('没有任何覆盖来源时取内置默认值', () => {
    expect(new AppConfigStore().get()).toEqual(DEFAULT_APP_CONFIG);
  });

  it('回读只有 applyAllDatesReadbackDays 一项，超时在顶层共用', () => {
    // 回读原先按渠道拆成两组（ctrip / meituan），各放一个同值的 timeoutMs。
    // 合并成一组 + 顶层 requestTimeoutMs 后，改超时只有一个地方可改。
    const config = new AppConfigStore().get();
    expect(config.inventoryReadback).toEqual({ applyAllDatesReadbackDays: 7 });
    expect(config.requestTimeoutMs).toBe(30_000);
  });

  // ⭐ 本文件最重要的一条：浅合并会让同组其余键整组消失，而类型上看不出来
  // （Partial 允许缺键），只在运行期炸。
  it('某一层只覆盖组内部分键时，未覆盖的键仍取下层的值', () => {
    const store = new AppConfigStore([source({ snapshotCleanup: { retentionDays: 10 } })]);

    const config = store.get();
    expect(config.snapshotCleanup.retentionDays).toBe(10);
    expect(config.snapshotCleanup.batchSize).toBe(DEFAULT_APP_CONFIG.snapshotCleanup.batchSize);
    expect(config.snapshotCleanup.idleMs).toBe(DEFAULT_APP_CONFIG.snapshotCleanup.idleMs);
  });

  it('多层覆盖时后面的层优先', () => {
    const store = new AppConfigStore([
      source({ snapshotCleanup: { retentionDays: 10, batchSize: 100 } }),
      source({ snapshotCleanup: { retentionDays: 20 } }),
    ]);

    const config = store.get();
    expect(config.snapshotCleanup.retentionDays).toBe(20);
    // 高优先级层没提的键，保留低优先级层的覆盖，而不是回落到默认值。
    expect(config.snapshotCleanup.batchSize).toBe(100);
  });

  it('来源返回 null 表示这层没有意见，不影响结果', () => {
    const store = new AppConfigStore([
      source({ inventoryReadback: { applyAllDatesReadbackDays: 14 } }),
      source(null),
    ]);

    expect(store.get().inventoryReadback.applyAllDatesReadbackDays).toBe(14);
  });

  // ⚠️ 顶层标量走的是 mergeConfig 里与分组不同的一条分支（分组是逐键展开，标量是
  // 整体替换）。没有这条，`{ ...5 }` 那个 TS2698 会以别的形式在运行期回来。
  it('顶层标量的覆盖是整体替换，且不影响其余分组', () => {
    const config = new AppConfigStore([source({ requestTimeoutMs: 5_000 })]).get();
    expect(config.requestTimeoutMs).toBe(5_000);
    expect(config.inventoryReadback).toEqual(DEFAULT_APP_CONFIG.inventoryReadback);
    expect(config.inventoryScan).toEqual(DEFAULT_APP_CONFIG.inventoryScan);
  });

  it('来源返回空对象时不改变任何值', () => {
    expect(new AppConfigStore([source({})]).get()).toEqual(DEFAULT_APP_CONFIG);
  });

  it('运行中来源的值变化能被下一次 get 读到', () => {
    // 不缓存合并结果的理由：将来服务端下发会在运行中变，缓存会让下发后仍用旧值。
    let patch: PartialAppConfig = { snapshotCleanup: { retentionDays: 1 } };
    const store = new AppConfigStore([{ read: () => patch }]);

    expect(store.get().snapshotCleanup.retentionDays).toBe(1);
    patch = { snapshotCleanup: { retentionDays: 2 } };
    expect(store.get().snapshotCleanup.retentionDays).toBe(2);
  });
});

describe('inventoryScan', () => {
  it('默认值可用', () => {
    const config = new AppConfigStore().get();
    // 15 天与携程页面自然读一次返回的范围对齐（真机实测）。取 7 的话，
    // 8~15 天那部分基线永远不会被比对。
    expect(config.inventoryScan.windows).toEqual({ kind: 'days', days: 15 });
    // 节奏所有环境统一 5 分钟（曾按 dev / pre·online 分档，两档取同值后取消分档）。
    expect(config.inventoryScan.idleMs).toBe(5 * 60_000);
    // 抖动恒为 idleMs 的 20%：没有抖动，集中部署的门店会长期同相位齐刷刷打渠道。
    expect(config.inventoryScan.jitterMs).toBe(config.inventoryScan.idleMs * 0.2);
    // 必须高于调度器的下限钳制，否则默认值本身就会被钳。
    expect(config.inventoryScan.idleMs).toBeGreaterThanOrEqual(30_000);
    // ⚠️ 总闸按构建环境分档：dev 开（真机验证不必手改代码），pre/online 关
    //（有外部副作用的周期性行为不该因装新版本就自己跑）。与 idleMs 同样断言不变量。
    expect(config.inventoryScan.enabled).toBe(APP_ENVIRONMENT === 'dev');
  });

  it('部分覆盖时同组未覆盖项保持默认', () => {
    const config = new AppConfigStore([
      { read: () => ({ inventoryScan: { idleMs: 5_000 } }) },
    ]).get();
    expect(config.inventoryScan.idleMs).toBe(5_000);
    // ⚠️ 浅合并会把 windows 抹成 undefined —— 这条守住 mergeConfig 的深合并。
    expect(config.inventoryScan.windows).toEqual({ kind: 'days', days: 15 });
  });

  // ⚠️ 守住「联合/数组是整体替换，不是逐元素合并」的约定，见 types.ts 的 PartialAppConfig。
  it('windows 是整体替换，不与默认值合并', () => {
    const config = new AppConfigStore([
      { read: () => ({ inventoryScan: { windows: { kind: 'days', days: 30 } } }) },
    ]).get();
    expect(config.inventoryScan.windows).toEqual({ kind: 'days', days: 30 });
  });

  it('加了新配置组后既有组不受影响', () => {
    const config = new AppConfigStore([
      { read: () => ({ inventoryScan: { idleMs: 1 } }) },
    ]).get();
    expect(config.inventoryReadback.applyAllDatesReadbackDays).toBe(7);
    expect(config.requestTimeoutMs).toBe(30_000);
  });
});

describe('inventoryScan 三层开关的合并深度', () => {
  // ⚠️ 本组守住 mergeConfig 的第二层深度。没有它，服务端只想关一家店会把其余店
  // 的配置全抹掉 —— 而这种失效在类型上看不出来，只有运行期才暴露。
  it('byHotel 逐店合并：只覆盖一家店，其余店保留', () => {
    const base = new AppConfigStore([
      {
        read: () => ({
          inventoryScan: {
            byHotel: { A: { enabled: true }, B: { enabled: true } },
          },
        }),
      },
      { read: () => ({ inventoryScan: { byHotel: { B: { enabled: false } } } }) },
    ]).get();

    expect(base.inventoryScan.byHotel).toEqual({
      A: { enabled: true },
      B: { enabled: false },
    });
  });

  it('channels 逐渠道合并：加一个渠道不抹掉既有渠道', () => {
    const config = new AppConfigStore([
      { read: () => ({ inventoryScan: { channels: { meituan: { enabled: true } } } }) },
    ]).get();

    expect(config.inventoryScan.channels).toEqual({
      ctrip: { enabled: true },
      meituan: { enabled: true },
    });
  });

  it('同一家店的部分字段覆盖，其余字段保留', () => {
    const config = new AppConfigStore([
      {
        read: () => ({
          inventoryScan: {
            byHotel: { A: { enabled: true, window: { kind: 'days' as const, days: 3 } } },
          },
        }),
      },
      { read: () => ({ inventoryScan: { byHotel: { A: { enabled: false } } } }) },
    ]).get();

    expect(config.inventoryScan.byHotel.A).toEqual({
      enabled: false,
      window: { kind: 'days', days: 3 },
    });
  });

  it('默认渠道表里携程与美团都开着，抖音不出现（未列出=关）', () => {
    // 抖音尚未接入扫描能力（registry 里没注册 inventoryScan），不该出现在默认表里。
    const config = new AppConfigStore().get();
    expect(config.inventoryScan.channels.ctrip).toEqual({ enabled: true });
    expect(config.inventoryScan.channels.meituan).toEqual({ enabled: true });
    expect(config.inventoryScan.channels.douyin).toBeUndefined();
  });

  it('默认 byHotel 为空（未列出=取上层值，新绑的店跟随渠道开关）', () => {
    const config = new AppConfigStore().get();
    expect(config.inventoryScan.byHotel).toEqual({});
  });
});
