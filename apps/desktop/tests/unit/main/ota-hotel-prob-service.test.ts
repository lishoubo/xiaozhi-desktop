import { describe, expect, it, vi } from 'vitest';
import { toChannelId, toOtaCredentialId, toOtaHotelId } from '../../../src/domain/identity';
import type { OtaCredential } from '../../../src/domain/ota-credential';
import {
  TabEventBus,
  type TabCredentialCheckedEvent,
} from '../../../src/main/services/tab-event-bus';
import { OtaHotelProbService } from '../../../src/main/services/ota-hotel-prob-service';
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

function fakeEvent(
  overrides: Partial<TabCredentialCheckedEvent> = {},
): TabCredentialCheckedEvent {
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

function createDeps(overrides: Record<string, unknown> = {}) {
  const tabEventBus = new TabEventBus();
  const repository = {
    create: vi.fn((input) => input),
    findByChannelAndHotelId: vi.fn(() => null),
    findByCredentialId: vi.fn(() => null),
    updateDiscovery: vi.fn(),
  };
  return {
    tabEventBus,
    probes: new Map([[toChannelId('douyin'), foundProbe()]]),
    repository,
    logger: createLogger(),
    ...overrides,
  };
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('OtaHotelProbService', () => {
  it('探测成功后创建新的酒店探测记录', async () => {
    const deps = createDeps();
    new OtaHotelProbService(deps as never);

    deps.tabEventBus.emitCredentialChecked(fakeEvent());
    await flushMicrotasks();

    expect(deps.repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialId: 'credential-1',
        channel: 'douyin',
        otaHotelId: 'dy-111',
        otaHotelName: '测试酒店',
      }),
    );
  });

  it('渠道已有探测记录时跳过，不重复探测', async () => {
    const probe = foundProbe();
    const deps = createDeps({
      probes: new Map([[toChannelId('douyin'), probe]]),
      repository: {
        create: vi.fn(),
        findByChannelAndHotelId: vi.fn(() => null),
        findByCredentialId: vi.fn(() => ({ id: 'existing' })),
        updateDiscovery: vi.fn(),
      },
    });
    new OtaHotelProbService(deps as never);

    deps.tabEventBus.emitCredentialChecked(fakeEvent());
    await flushMicrotasks();

    expect(probe.probe).not.toHaveBeenCalled();
  });

  it('URL 不满足 isProbeableUrl 时不触发探测', async () => {
    const probe: HotelProbe = {
      isProbeableUrl: vi.fn(() => false),
      probe: vi.fn(),
    };
    const deps = createDeps({ probes: new Map([[toChannelId('douyin'), probe]]) });
    new OtaHotelProbService(deps as never);

    deps.tabEventBus.emitCredentialChecked(fakeEvent());
    await flushMicrotasks();

    expect(probe.probe).not.toHaveBeenCalled();
  });

  it('渠道未注册 probe 时直接跳过', async () => {
    const deps = createDeps({ probes: new Map() });
    new OtaHotelProbService(deps as never);

    deps.tabEventBus.emitCredentialChecked(fakeEvent());
    await flushMicrotasks();

    expect(deps.repository.create).not.toHaveBeenCalled();
  });

  it('outcome.kind 不是 checked 时不触发探测', async () => {
    const probe = foundProbe();
    const deps = createDeps({ probes: new Map([[toChannelId('douyin'), probe]]) });
    new OtaHotelProbService(deps as never);

    deps.tabEventBus.emitCredentialChecked(
      fakeEvent({ outcome: { kind: 'not-applicable' } }),
    );
    await flushMicrotasks();

    expect(probe.probe).not.toHaveBeenCalled();
  });

  it('outcome.credential 为 null 时不触发探测', async () => {
    const probe = foundProbe();
    const deps = createDeps({ probes: new Map([[toChannelId('douyin'), probe]]) });
    new OtaHotelProbService(deps as never);

    deps.tabEventBus.emitCredentialChecked(
      fakeEvent({ outcome: { kind: 'checked', credential: null } }),
    );
    await flushMicrotasks();

    expect(probe.probe).not.toHaveBeenCalled();
  });

  it('探测抛错时记录警告，不影响后续事件', async () => {
    const probe: HotelProbe = {
      isProbeableUrl: vi.fn(() => true),
      probe: vi.fn().mockRejectedValue(new Error('boom')),
    };
    const deps = createDeps({ probes: new Map([[toChannelId('douyin'), probe]]) });
    new OtaHotelProbService(deps as never);

    deps.tabEventBus.emitCredentialChecked(fakeEvent());
    await flushMicrotasks();

    expect(deps.logger.warn).toHaveBeenCalledWith(
      'Hotel probe failed',
      expect.objectContaining({ channel: 'douyin' }),
    );
    expect(deps.repository.create).not.toHaveBeenCalled();
  });

  it('已存在同渠道同酒店记录时更新而非新建', async () => {
    const probe = foundProbe();
    const deps = createDeps({
      probes: new Map([[toChannelId('douyin'), probe]]),
      repository: {
        create: vi.fn(),
        findByChannelAndHotelId: vi.fn(() => ({ id: 'existing-hotel' })),
        findByCredentialId: vi.fn(() => null),
        updateDiscovery: vi.fn(),
      },
    });
    new OtaHotelProbService(deps as never);

    deps.tabEventBus.emitCredentialChecked(fakeEvent());
    await flushMicrotasks();

    expect(deps.repository.updateDiscovery).toHaveBeenCalledWith(
      'existing-hotel',
      expect.objectContaining({ credentialId: 'credential-1' }),
    );
    expect(deps.repository.create).not.toHaveBeenCalled();
  });
});
