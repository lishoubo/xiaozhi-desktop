/**
 * 渠道注册表 —— 新增一个渠道只需在 `channels/<name>/` 下建目录，再在这里加一行。
 * services 与 composition root 都不需要认识具体渠道。
 *
 * 目前只收拢 `loginUrlMatcher` 与 `hotelProbe` 这两个三渠道同构的能力。
 * `discovery` 尚未收进来：三个渠道的 discover 函数签名各不相同
 * （`DiscoverCtrip` / `DiscoverDouyin` / `DiscoverMeituan` 各有各的入参与结果
 * 类型），统一它们需要改三个渠道的实现，不属于本次结构调整的范围。
 */
import { toChannelId, type ChannelId } from '../ids';
import type { AppLogger } from '../../shared/logging';
import { createCtripAmountChangeAdapter } from './ctrip/amount-change-adapter';
import { ctripHotelProbe } from './ctrip/hotel-prob';
import { ctripLoginUrlMatcher } from './ctrip/login-url-matcher';
import { createDouyinHotelProbe } from './douyin/hotel-prob';
import { douyinLoginUrlMatcher } from './douyin/login-url-matcher';
import {
  createMeituanAmountChangeAdapter,
  INVENTORY_ENDPOINT_ID as MEITUAN_INVENTORY_ENDPOINT_ID,
} from './meituan/amount-change-adapter';
import { createMeituanInventoryScan } from './meituan/inventory-scan';
import { createMeituanInventoryReadback } from './meituan/inventory-readback';
import { meituanReadbackFetcher } from './meituan/inventory-readback-fetcher';
import { meituanHotelProbe } from './meituan/hotel-prob';
import { meituanLoginUrlMatcher } from './meituan/login-url-matcher';
import { createCtripInventoryReadback } from './ctrip/inventory-readback';
import { createCtripInventoryScan } from './ctrip/inventory-scan';
import { ctripReadbackFetcher } from './ctrip/inventory-readback-fetcher';
import { ctripBatchTaskGate } from './ctrip/batch-task-gate';
import type { AppConfig } from '../app-config/types';
import type {
  AmountChangeAdapter,
  HotelProbe,
  InventoryReadback,
  InventoryScan,
  LoginUrlMatcher,
  ScanFetcher,
} from './types';

export type ChannelAdapter = Readonly<{
  channel: ChannelId;
  loginUrlMatcher: LoginUrlMatcher;
  hotelProbe: HotelProbe;
  /**
   * 价量态改动监听能力。**可选**：三个渠道目前都已实装，但保留可选性 ——
   * 新接入的渠道在踩点完成前不该被迫写一个空实现（空实现的 `isWatchableUrl` 永远
   * 返回 false，读代码的人得点进去才知道「这渠道其实没做」；可选字段在下面的注册表里
   * 一眼看得出谁有谁没有）。
   */
  amountChangeAdapter?: AmountChangeAdapter;
  /**
   * 房量回读能力。**可选**：携程与美团已实装。
   *
   * 抖音是被跟价的那一端，回读它没有意义 —— 与 `amountChangeAdapter` 刻意不注册抖音
   * 同一理由。
   */
  inventoryReadback?: InventoryReadback;
  /**
   * 定时扫描取数能力。**可选**：本期只有携程。
   *
   * 与 `inventoryReadback` 的差别是**不依赖标签页** —— 它用账号会话发请求，
   * 定时触发时用户可能压根没开页面。
   */
  inventoryScan?: InventoryScan;
}>;

export function createChannelRegistry(
  logger: AppLogger,
  appConfig: () => AppConfig,
  /**
   * 用账号会话发请求。由 composition 注入 —— `session.fromPartition()` 的唯一持有者是
   * `browser/session-factory.ts`，渠道层够不着。
   *
   * **可选**：省略即不注册扫描能力（`inventoryScans()` 自然跳过），既有调用方不用改。
   */
  scanFetcher?: ScanFetcher,
): ReadonlyMap<ChannelId, ChannelAdapter> {
  // 批量任务门控是渠道级单例（状态按全局唯一的 taskId 分键），logger 在这里才有。
  ctripBatchTaskGate.setLogger(logger);

  const adapters: readonly ChannelAdapter[] = [
    {
      channel: toChannelId('ctrip'),
      loginUrlMatcher: ctripLoginUrlMatcher,
      hotelProbe: ctripHotelProbe,
      amountChangeAdapter: createCtripAmountChangeAdapter(logger),
      inventoryReadback: createCtripInventoryReadback({
        logger,
        fetcher: ctripReadbackFetcher,
        // 每次调用时才读配置 —— 将来服务端下发是会在运行中变的，构造时取一次会让下发失效。
        config: () => appConfig().ctripInventoryReadback,
      }),
      inventoryScan: scanFetcher
        ? createCtripInventoryScan({
            logger,
            fetcher: scanFetcher,
            config: () => ({ timeoutMs: appConfig().inventoryScan.timeoutMs }),
          })
        : undefined,
    },
    {
      channel: toChannelId('douyin'),
      loginUrlMatcher: douyinLoginUrlMatcher,
      hotelProbe: createDouyinHotelProbe(logger),
      // 改价监听**刻意不注册**：抖音是被跟价的那一端（RMS 把携程/美团的变更跟到抖音），
      // 监听它等于把 RMS 自己写进去的价再报回 RMS。服务端也是这么判的——接入文档 §6 把
      // douyin 归到 `SOURCE_NOT_SUPPORTED`，注明「自己追自己无意义」。
      //
      // 适配器代码（`createDouyinAmountChangeAdapter`）与它的测试全部保留：抖音的报文
      // 形状是真机踩过点的，将来若要做「抖音侧手工改价回流」，接回来只是这里加一行。
      // 这也是 `amountChangeAdapter` 设计成可选字段的用意——不注册即不监听，
      // 见 `amountChangeAdapters()`。
    },
    {
      channel: toChannelId('meituan'),
      loginUrlMatcher: meituanLoginUrlMatcher,
      hotelProbe: meituanHotelProbe,
      amountChangeAdapter: createMeituanAmountChangeAdapter(logger),
      inventoryReadback: createMeituanInventoryReadback({
        logger,
        fetcher: meituanReadbackFetcher,
        inventoryEndpointId: MEITUAN_INVENTORY_ENDPOINT_ID,
        config: () => appConfig().meituanInventoryReadback,
      }),
      // ⚠️ 与携程共用同一个 scanFetcher（形状本就渠道无关，头由各渠道实现自己填）。
      // 省略 scanFetcher 即不注册 —— `inventoryScans()` 投影会自然跳过。
      inventoryScan: scanFetcher
        ? createMeituanInventoryScan({
            logger,
            fetcher: scanFetcher,
            config: () => ({ timeoutMs: appConfig().inventoryScan.timeoutMs }),
          })
        : undefined,
    },
  ];
  return new Map(adapters.map((adapter) => [adapter.channel, adapter]));
}

/** 从注册表投影出 `OtaTabService` 需要的那一份。 */
export function loginUrlMatchers(
  registry: ReadonlyMap<ChannelId, ChannelAdapter>,
): ReadonlyMap<ChannelId, LoginUrlMatcher> {
  return new Map(
    Array.from(registry, ([channel, adapter]) => [channel, adapter.loginUrlMatcher] as const),
  );
}

/** 从注册表投影出 `HotelProbeDispatcher` 需要的那一份。 */
export function hotelProbes(
  registry: ReadonlyMap<ChannelId, ChannelAdapter>,
): ReadonlyMap<ChannelId, HotelProbe> {
  return new Map(
    Array.from(registry, ([channel, adapter]) => [channel, adapter.hotelProbe] as const),
  );
}

/**
 * 从注册表投影出 `AmountChangeWatcher` 需要的那一份。**跳过没有这项能力的渠道** ——
 * watcher 拿不到适配器就不会去监听那个渠道。
 */
export function amountChangeAdapters(
  registry: ReadonlyMap<ChannelId, ChannelAdapter>,
): ReadonlyMap<ChannelId, AmountChangeAdapter> {
  const entries: (readonly [ChannelId, AmountChangeAdapter])[] = [];
  for (const [channel, adapter] of registry) {
    if (adapter.amountChangeAdapter) entries.push([channel, adapter.amountChangeAdapter] as const);
  }
  return new Map(entries);
}

/**
 * 从注册表投影出 `InventoryReadbackDispatcher` 需要的那一份。**跳过没有这项能力的渠道** ——
 * dispatcher 拿不到实现就不会对那个渠道做回读（照 `amountChangeAdapters()` 的写法）。
 */
export function inventoryReadbacks(
  registry: ReadonlyMap<ChannelId, ChannelAdapter>,
): ReadonlyMap<ChannelId, InventoryReadback> {
  const entries: (readonly [ChannelId, InventoryReadback])[] = [];
  for (const [channel, adapter] of registry) {
    if (adapter.inventoryReadback) entries.push([channel, adapter.inventoryReadback] as const);
  }
  return new Map(entries);
}

/**
 * 从注册表投影出 `InventoryScanDispatcher` 需要的那一份。**跳过没有这项能力的渠道** ——
 * 照 `inventoryReadbacks()` 的写法。
 */
export function inventoryScans(
  registry: ReadonlyMap<ChannelId, ChannelAdapter>,
): ReadonlyMap<ChannelId, InventoryScan> {
  const entries: (readonly [ChannelId, InventoryScan])[] = [];
  for (const [channel, adapter] of registry) {
    if (adapter.inventoryScan) entries.push([channel, adapter.inventoryScan] as const);
  }
  return new Map(entries);
}
