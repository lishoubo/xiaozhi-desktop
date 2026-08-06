import type { ChannelId } from '../../domain/identity';
import type { AppLogger } from '../../shared/logging';
import { DouyinDiscoveryProbe } from './douyin-discovery';
import type { DiscoveryProbe } from './discovery-probe-port';

/** channel → DiscoveryProbe registry。查不到的渠道视为不支持探测。 */
export function createDiscoveryProbes(logger: AppLogger): ReadonlyMap<ChannelId, DiscoveryProbe> {
  const douyin = new DouyinDiscoveryProbe(logger);
  return new Map<ChannelId, DiscoveryProbe>([[douyin.channel, douyin]]);
}
