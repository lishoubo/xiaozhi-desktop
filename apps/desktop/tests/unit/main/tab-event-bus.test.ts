import { describe, expect, it, vi } from 'vitest';
import {
  TabEventBus,
  type TabCredentialCheckedEvent,
} from '../../../src/main/services/tab-event-bus';

function fakeEvent(
  overrides: Partial<TabCredentialCheckedEvent> = {},
): TabCredentialCheckedEvent {
  return {
    tabId: 'tab-1',
    partitionName: 'persist:xiaozhi:prod:ctrip:aaa',
    channel: 'ctrip',
    url: 'https://ebooking.ctrip.com/home/mainland',
    webContents: {} as never,
    outcome: { kind: 'not-applicable' },
    ...overrides,
  };
}

describe('TabEventBus', () => {
  it('emitCredentialChecked 广播给所有订阅者', () => {
    const bus = new TabEventBus();
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    bus.on('tab:credential-checked', listenerA);
    bus.on('tab:credential-checked', listenerB);

    const event = fakeEvent();
    bus.emitCredentialChecked(event);

    expect(listenerA).toHaveBeenCalledWith(event);
    expect(listenerB).toHaveBeenCalledWith(event);
  });

  it('没有订阅者时不抛错', () => {
    const bus = new TabEventBus();
    expect(() => bus.emitCredentialChecked(fakeEvent())).not.toThrow();
  });

  it('取消订阅后不再收到广播', () => {
    const bus = new TabEventBus();
    const listener = vi.fn();
    bus.on('tab:credential-checked', listener);
    bus.off('tab:credential-checked', listener);

    bus.emitCredentialChecked(fakeEvent());

    expect(listener).not.toHaveBeenCalled();
  });
});
