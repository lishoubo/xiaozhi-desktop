import { describe, expect, it, vi } from 'vitest';
import { toChannelId, toOtaCredentialId, toOtaHotelId } from '../../../src/main/ids';
import type { OtaCredential } from '../../../src/shared/types/ota-credential';
import { TabEventBus, type TabCredentialCheckedEvent } from '../../../src/main/ota-tab';
import type { HotelProbe, HotelProbeOutcome } from '../../../src/main/channels/types';
import {
  ReauthByHotelDispatcher,
  type ReauthByHotelDispatcherDependencies,
} from '../../../src/main/channels/reauth-by-hotel-dispatcher';

function credential(overrides: Partial<OtaCredential> = {}): OtaCredential {
  return {
    id: toOtaCredentialId('credential-1'),
    channel: toChannelId('douyin'),
    channelAccountId: 'account-1',
    channelAccountName: null,
    partitionName: 'persist:xiaozhi:prod:douyin:aaa',
    credentialExtra: null,
    discoveredAt: 100,
    lastRefreshedAt: null,
    ...overrides,
  };
}

const INTENT = {
  kind: 'reauth-by-hotel',
  requestId: 'req-1',
  expectedOtaHotelId: 'hotel-1',
  otaAccountId: 42,
} as const;

function fakeEvent(overrides: Partial<TabCredentialCheckedEvent> = {}): TabCredentialCheckedEvent {
  return {
    tabId: 'tab-1',
    partitionName: 'persist:xiaozhi:prod:douyin:aaa',
    channel: 'douyin',
    url: 'https://life.douyin.com/p/home',
    webContents: { isDestroyed: () => false } as never,
    outcome: { kind: 'checked', credential: credential() },
    intent: INTENT,
    ...overrides,
  };
}

function probeReturning(outcome: HotelProbeOutcome, probe = vi.fn()): HotelProbe {
  probe.mockResolvedValue(outcome);
  return { isProbeableUrl: () => true, probe };
}

function createDeps(probe: HotelProbe) {
  return {
    tabEventBus: new TabEventBus(),
    probes: new Map([[toChannelId('douyin'), probe]]),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    notify: vi.fn(),
  } satisfies ReauthByHotelDispatcherDependencies;
}

/** 事件回调是 async 的，emit 之后要让出一轮微任务才能看到 notify。 */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('ReauthByHotelDispatcher', () => {
  /**
   * 通过时**只报凭证 id**。命中门店的 `bindExtra`（抖音 merchantGroupId / 美团
   * otaPartnerId）有意不带回：那是门店级参数，同一账号下每家门店可能不同，而这条路
   * 没让用户确认门店，写进去会让 RPA 拿错参数跑。
   */
  it('探测到的门店包含目标门店时通过，且不带回门店级渠道字段', async () => {
    const deps = createDeps(
      probeReturning({
        kind: 'found',
        hotels: [
          {
            otaHotelId: toOtaHotelId('hotel-1'),
            otaHotelName: '璞禾华发新城店',
            bindExtra: { merchantGroupId: 'group-9' },
          },
        ],
      }),
    );
    new ReauthByHotelDispatcher(deps);

    deps.tabEventBus.emitCredentialChecked(fakeEvent());
    await flush();

    expect(deps.notify).toHaveBeenCalledWith({
      requestId: 'req-1',
      kind: 'reauth-ota',
      payload: { ok: true, credentialId: 'credential-1' },
    });
  });

  /**
   * 核心防线：这个账号管不了这家门店却放行，等于把另一个账号的登录态写到这条绑定
   * 上——与 `OtaReauthDispatcher` 拦「登录了另一个账号」是同一类事故。
   */
  it('探测结果里没有目标门店时拒绝，并带回该账号实际管的门店', async () => {
    const deps = createDeps(
      probeReturning({
        kind: 'found',
        hotels: [
          { otaHotelId: toOtaHotelId('hotel-2'), otaHotelName: '另一家店', bindExtra: null },
        ],
      }),
    );
    new ReauthByHotelDispatcher(deps);

    deps.tabEventBus.emitCredentialChecked(fakeEvent());
    await flush();

    expect(deps.notify).toHaveBeenCalledWith({
      requestId: 'req-1',
      kind: 'reauth-ota',
      payload: {
        ok: false,
        reason: 'hotel-mismatch',
        actualHotels: [{ otaHotelId: 'hotel-2', otaHotelName: '另一家店', bindExtra: null }],
      },
    });
  });

  /**
   * 「探不出门店」与「探出来了但不是这家」要分开报：前者重试有意义，后者重试多少次
   * 都一样。混成一种会让用户白试。
   */
  it('探不到门店时报 identity-unavailable，不报 hotel-mismatch', async () => {
    const deps = createDeps(probeReturning({ kind: 'none' }));
    new ReauthByHotelDispatcher(deps);

    deps.tabEventBus.emitCredentialChecked(fakeEvent());
    await flush();

    expect(deps.notify).toHaveBeenCalledWith({
      requestId: 'req-1',
      kind: 'reauth-ota',
      payload: { ok: false, reason: 'identity-unavailable' },
    });
  });

  it('探测期间用户关掉标签页时什么都不通知', async () => {
    const deps = createDeps(
      probeReturning({
        kind: 'found',
        hotels: [{ otaHotelId: toOtaHotelId('hotel-1'), otaHotelName: null, bindExtra: null }],
      }),
    );
    new ReauthByHotelDispatcher(deps);

    deps.tabEventBus.emitCredentialChecked(
      fakeEvent({ webContents: { isDestroyed: () => true } as never }),
    );
    await flush();

    expect(deps.notify).not.toHaveBeenCalled();
  });

  it('不是自己的 intent 就完全不探测', async () => {
    const probe = vi.fn();
    const deps = createDeps(probeReturning({ kind: 'none' }, probe));
    new ReauthByHotelDispatcher(deps);

    deps.tabEventBus.emitCredentialChecked(
      fakeEvent({
        intent: { kind: 'reauth-ota', requestId: 'req-2', expectedChannelAccountId: 'account-1' },
      }),
    );
    await flush();

    expect(probe).not.toHaveBeenCalled();
    expect(deps.notify).not.toHaveBeenCalled();
  });
});
