/**
 * 渠道注册表 —— 新增一个渠道只需在 `channels/<name>/` 下建目录，再在这里加一行。
 * services 与 composition root 都不需要认识具体渠道。
 *
 * 目前只收拢 `loginUrlMatcher` 与 `hotelProbe` 这两个三渠道同构的能力。
 * `discovery` 尚未收进来：三个渠道的 discover 函数签名各不相同
 * （`DiscoverCtrip` / `DiscoverDouyin` / `DiscoverMeituan` 各有各的入参与结果
 * 类型），统一它们需要改三个渠道的实现，不属于本次结构调整的范围。
 */
import { toChannelId, type ChannelId } from '../../domain/identity';
import type { AppLogger } from '../../shared/logging';
import { ctripHotelProbe } from './ctrip/hotel-prob';
import { ctripLoginUrlMatcher } from './ctrip/login-url-matcher';
import { createDouyinHotelProbe } from './douyin/hotel-prob';
import { douyinLoginUrlMatcher } from './douyin/login-url-matcher';
import { meituanHotelProbe } from './meituan/hotel-prob';
import { meituanLoginUrlMatcher } from './meituan/login-url-matcher';
import type { HotelProbe, LoginUrlMatcher } from './types';

export type ChannelAdapter = Readonly<{
  channel: ChannelId;
  loginUrlMatcher: LoginUrlMatcher;
  hotelProbe: HotelProbe;
}>;

export function createChannelRegistry(logger: AppLogger): ReadonlyMap<ChannelId, ChannelAdapter> {
  const adapters: readonly ChannelAdapter[] = [
    {
      channel: toChannelId('ctrip'),
      loginUrlMatcher: ctripLoginUrlMatcher,
      hotelProbe: ctripHotelProbe,
    },
    {
      channel: toChannelId('douyin'),
      loginUrlMatcher: douyinLoginUrlMatcher,
      hotelProbe: createDouyinHotelProbe(logger),
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

/** 从注册表投影出 `OtaHotelProbService` 需要的那一份。 */
export function hotelProbes(
  registry: ReadonlyMap<ChannelId, ChannelAdapter>,
): ReadonlyMap<ChannelId, HotelProbe> {
  return new Map(
    Array.from(registry, ([channel, adapter]) => [channel, adapter.hotelProbe] as const),
  );
}
