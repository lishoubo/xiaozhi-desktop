import type { ChannelId } from '../../../domain/identity';
import type { DiscoveryProbe } from './discovery-probe-port';

/** channel → DiscoveryProbe registry。查不到的渠道视为不支持探测。 */
export function createDiscoveryProbes(): ReadonlyMap<ChannelId, DiscoveryProbe> {
  return new Map<ChannelId, DiscoveryProbe>();
}
