import { describe, expect, it, vi } from 'vitest';
import { toChannelId, toOtaCredentialId, toOtaHotelId } from '../../../src/main/ids';
import type { OtaCredential } from '../../../src/shared/types/ota-credential';
import {
  TabEventBus,
  type TabCredentialCheckedEvent,
} from '../../../src/main/ota-tab';
import {
  HotelProbeDispatcher,
  type HotelProbeDispatcherDependencies,
} from '../../../src/main/channels/hotel-probe-dispatcher';
import type { HotelProbe } from '../../../src/main/channels/types';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function credential(overrides: Partial<OtaCredential> = {}): OtaCredential {
  return {
    id: toOtaCredentialId('credential-1'),
    channel: toChannelId('douyin'),
    channelAccountId: 'account-1',
    partitionName: 'persist:xiaozhi:prod:douyin:aaa',
    credentialExtra: null,
    discoveredAt: 100,
    lastRefreshedAt: null,
    ...overrides,
  };
}

function fakeEvent(overrides: Partial<TabCredentialCheckedEvent> = {}): TabCredentialCheckedEvent {
  return {
    tabId: 'tab-1',
    partitionName: 'persist:xiaozhi:prod:douyin:aaa',
    channel: 'douyin',
    url: 'https://life.douyin.com/p/home?groupid=1',
    webContents: {} as never,
    outcome: { kind: 'checked', credential: credential() },
    ...overrides,
  };
}

function foundProbe(): HotelProbe {
  return {
    isProbeableUrl: vi.fn(() => true),
    probe: vi.fn().mockResolvedValue({
      kind: 'found',
      hotels: [{ otaHotelId: toOtaHotelId('dy-111'), otaHotelName: '测试酒店', bindExtra: null }],
    }),
  };
}

/** 只允许覆盖 probes：logger 与 tabEventBus 需要在用例里断言，保持具体类型。 */
function createDeps(overrides: Pick<Partial<HotelProbeDispatcherDependencies>, 'probes'> = {}) {
  return {
    tabEventBus: new TabEventBus(),
    probes: new Map([[toChannelId('douyin'), foundProbe()]]),
    logger: createLogger(),
    ...overrides,
  } satisfies HotelProbeDispatcherDependencies;
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('HotelProbeDispatcher', () => {
  it('探测成功只产出候选日志，不写库', async () => {
    const probe = foundProbe();
    const deps = createDeps({ probes: new Map([[toChannelId('douyin'), probe]]) });
    new HotelProbeDispatcher(deps);

    deps.tabEventBus.emitCredentialChecked(fakeEvent());
    await flushMicrotasks();

    expect(probe.probe).toHaveBeenCalledTimes(1);
    expect(deps.logger.info).toHaveBeenCalledWith(
      'Hotel probe found candidates',
      expect.objectContaining({ channel: 'douyin', hotelCount: 1 }),
    );
  });

  it('同一凭证连续两次事件都会执行探测（用户否决后可重试）', async () => {
    const probe = foundProbe();
    const deps = createDeps({ probes: new Map([[toChannelId('douyin'), probe]]) });
    new HotelProbeDispatcher(deps);

    deps.tabEventBus.emitCredentialChecked(fakeEvent());
    await flushMicrotasks();
    deps.tabEventBus.emitCredentialChecked(fakeEvent());
    await flushMicrotasks();

    expect(probe.probe).toHaveBeenCalledTimes(2);
  });

  it('URL 不满足 isProbeableUrl 时不触发探测', async () => {
    const probe: HotelProbe = {
      isProbeableUrl: vi.fn(() => false),
      probe: vi.fn(),
    };
    const deps = createDeps({ probes: new Map([[toChannelId('douyin'), probe]]) });
    new HotelProbeDispatcher(deps);

    deps.tabEventBus.emitCredentialChecked(fakeEvent());
    await flushMicrotasks();

    expect(probe.probe).not.toHaveBeenCalled();
  });

  it('渠道未注册 probe 时直接跳过', async () => {
    const deps = createDeps({ probes: new Map() });
    new HotelProbeDispatcher(deps);

    deps.tabEventBus.emitCredentialChecked(fakeEvent());
    await flushMicrotasks();

    expect(deps.logger.info).not.toHaveBeenCalled();
  });

  it('outcome.kind 不是 checked 时不触发探测', async () => {
    const probe = foundProbe();
    const deps = createDeps({ probes: new Map([[toChannelId('douyin'), probe]]) });
    new HotelProbeDispatcher(deps);

    deps.tabEventBus.emitCredentialChecked(fakeEvent({ outcome: { kind: 'not-applicable' } }));
    await flushMicrotasks();

    expect(probe.probe).not.toHaveBeenCalled();
  });

  it('outcome.credential 为 null 时不触发探测', async () => {
    const probe = foundProbe();
    const deps = createDeps({ probes: new Map([[toChannelId('douyin'), probe]]) });
    new HotelProbeDispatcher(deps);

    deps.tabEventBus.emitCredentialChecked(
      fakeEvent({ outcome: { kind: 'checked', credential: null } }),
    );
    await flushMicrotasks();

    expect(probe.probe).not.toHaveBeenCalled();
  });

  it('探测抛错时记录警告，不产出候选', async () => {
    const probe: HotelProbe = {
      isProbeableUrl: vi.fn(() => true),
      probe: vi.fn().mockRejectedValue(new Error('boom')),
    };
    const deps = createDeps({ probes: new Map([[toChannelId('douyin'), probe]]) });
    new HotelProbeDispatcher(deps);

    deps.tabEventBus.emitCredentialChecked(fakeEvent());
    await flushMicrotasks();

    expect(deps.logger.warn).toHaveBeenCalledWith(
      'Hotel probe failed',
      expect.objectContaining({ channel: 'douyin' }),
    );
    expect(deps.logger.info).not.toHaveBeenCalled();
  });

  it('probe 返回 none 时不产出候选', async () => {
    const probe: HotelProbe = {
      isProbeableUrl: vi.fn(() => true),
      probe: vi.fn().mockResolvedValue({ kind: 'none' }),
    };
    const deps = createDeps({ probes: new Map([[toChannelId('douyin'), probe]]) });
    new HotelProbeDispatcher(deps);

    deps.tabEventBus.emitCredentialChecked(fakeEvent());
    await flushMicrotasks();

    expect(deps.logger.info).not.toHaveBeenCalled();
  });
});
