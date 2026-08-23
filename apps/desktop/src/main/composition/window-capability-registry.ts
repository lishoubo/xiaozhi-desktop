import type { ChannelId } from '../ids';

export type WindowCapabilities = Readonly<{
  retirePartition(partitionName: string): Promise<void>;
  notifyAccountBound(channel: ChannelId): void;
}>;

export type WindowCapabilityRegistration = Readonly<{
  dispose(): void;
}>;

export type WindowCapabilityRegistry = Readonly<{
  attach(capabilities: WindowCapabilities): WindowCapabilityRegistration;
  current(): WindowCapabilities | null;
  requireCurrent(): WindowCapabilities;
}>;

export function createWindowCapabilityRegistry(): WindowCapabilityRegistry {
  let attached: WindowCapabilities | null = null;

  return {
    attach(capabilities) {
      if (attached) throw new Error('Window capabilities are already attached');
      attached = capabilities;
      let disposed = false;
      return {
        dispose() {
          if (disposed) return;
          disposed = true;
          if (attached === capabilities) attached = null;
        },
      };
    },
    current() {
      return attached;
    },
    requireCurrent() {
      if (!attached) throw new Error('Window capabilities are unavailable');
      return attached;
    },
  };
}
