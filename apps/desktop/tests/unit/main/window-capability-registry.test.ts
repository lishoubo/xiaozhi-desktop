import { describe, expect, it, vi } from 'vitest';
import {
  createWindowCapabilityRegistry,
  type WindowCapabilities,
} from '../../../src/main/composition/window-capability-registry';

function capabilities(): WindowCapabilities {
  return {
    retirePartition: vi.fn().mockResolvedValue(undefined),
    notifyAccountBound: vi.fn(),
  };
}

describe('WindowCapabilityRegistry', () => {
  it('exposes one attached window and detaches it through its registration', () => {
    const registry = createWindowCapabilityRegistry();
    const current = capabilities();

    expect(registry.current()).toBeNull();
    expect(() => registry.requireCurrent()).toThrow('Window capabilities are unavailable');
    const registration = registry.attach(current);
    expect(registry.current()).toBe(current);
    expect(registry.requireCurrent()).toBe(current);

    registration.dispose();
    expect(registry.current()).toBeNull();
    expect(() => registry.requireCurrent()).toThrow('Window capabilities are unavailable');
    registration.dispose();
    expect(registry.current()).toBeNull();
  });

  it('rejects a second window until the current registration is disposed', () => {
    const registry = createWindowCapabilityRegistry();
    const first = registry.attach(capabilities());

    expect(() => registry.attach(capabilities())).toThrow('Window capabilities are already attached');

    first.dispose();
    expect(() => registry.attach(capabilities())).not.toThrow();
  });
});
