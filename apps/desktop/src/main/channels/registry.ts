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
import { createDouyinAmountChangeAdapter } from './douyin/amount-change-adapter';
import { createDouyinHotelProbe } from './douyin/hotel-prob';
import { douyinLoginUrlMatcher } from './douyin/login-url-matcher';
import { meituanHotelProbe } from './meituan/hotel-prob';
import { meituanLoginUrlMatcher } from './meituan/login-url-matcher';
import type { AmountChangeAdapter, HotelProbe, LoginUrlMatcher } from './types';

export type ChannelAdapter = Readonly<{
  channel: ChannelId;
  loginUrlMatcher: LoginUrlMatcher;
  hotelProbe: HotelProbe;
  /**
   * 价量态改动监听能力。**可选**：抖音与携程已实装，美团尚无改价踩点。
   *
   * 用可选字段而不是给那两个渠道写空实现：空实现的 `isWatchableUrl` 永远返回 false，
   * 读代码的人得点进去才知道「这渠道其实没做」；可选字段在下面的注册表里一眼看得出
   * 谁有谁没有。
   */
  amountChangeAdapter?: AmountChangeAdapter;
}>;

export function createChannelRegistry(logger: AppLogger): ReadonlyMap<ChannelId, ChannelAdapter> {
  const adapters: readonly ChannelAdapter[] = [
    {
      channel: toChannelId('ctrip'),
      loginUrlMatcher: ctripLoginUrlMatcher,
      hotelProbe: ctripHotelProbe,
      amountChangeAdapter: createCtripAmountChangeAdapter(logger),
    },
    {
      channel: toChannelId('douyin'),
      loginUrlMatcher: douyinLoginUrlMatcher,
      hotelProbe: createDouyinHotelProbe(logger),
      amountChangeAdapter: createDouyinAmountChangeAdapter(logger),
    },
    {
      channel: toChannelId('meituan'),
      loginUrlMatcher: meituanLoginUrlMatcher,
      hotelProbe: meituanHotelProbe,
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
 * 投影出来的 Map 里没有携程/美团，watcher 拿不到适配器就不会去监听它们。
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
