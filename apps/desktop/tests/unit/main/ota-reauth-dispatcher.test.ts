import { describe, expect, it, vi } from 'vitest';
import { toChannelId, toOtaCredentialId } from '../../../src/main/ids';
import type { OtaCredential } from '../../../src/shared/types/ota-credential';
import { TabEventBus, type TabCredentialCheckedEvent } from '../../../src/main/ota-tab';
import {
  OtaReauthDispatcher,
  type OtaReauthDispatcherDependencies,
} from '../../../src/main/channels/ota-reauth-dispatcher';

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

const REAUTH_INTENT = {
  kind: 'reauth-ota',
  requestId: 'req-1',
  expectedChannelAccountId: 'account-1',
} as const;

function fakeEvent(overrides: Partial<TabCredentialCheckedEvent> = {}): TabCredentialCheckedEvent {
  return {
    tabId: 'tab-1',
    partitionName: 'persist:xiaozhi:prod:douyin:aaa',
    channel: 'douyin',
    url: 'https://life.douyin.com/p/home',
    webContents: { isDestroyed: () => false } as never,
    outcome: { kind: 'checked', credential: credential() },
    intent: REAUTH_INTENT,
    ...overrides,
  };
}

function createDeps() {
  return {
    tabEventBus: new TabEventBus(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    notify: vi.fn(),
  } satisfies OtaReauthDispatcherDependencies;
}

describe('OtaReauthDispatcher', () => {
  it('登录的就是所选账号时通知成功，并带回凭证 id', () => {
    const deps = createDeps();
    new OtaReauthDispatcher(deps);

    deps.tabEventBus.emitCredentialChecked(fakeEvent());

    expect(deps.notify).toHaveBeenCalledWith({
      requestId: 'req-1',
      kind: 'reauth-ota',
      payload: { ok: true, credentialId: 'credential-1' },
    });
  });

  /**
   * 核心防线：不核对就把新 cookie 写上去，等于把账号 B 的登录态更新到账号 A 的绑定
   * 上——远端状态还会变正常，比原来的「过期」更糟且不报错。
   */
  it('登录了另一个账号时明确拒绝，不通知成功', () => {
    const deps = createDeps();
    new OtaReauthDispatcher(deps);

    deps.tabEventBus.emitCredentialChecked(
      fakeEvent({
        outcome: { kind: 'checked', credential: credential({ channelAccountId: 'account-2' }) },
      }),
    );

    expect(deps.notify).toHaveBeenCalledWith({
      requestId: 'req-1',
      kind: 'reauth-ota',
      payload: { ok: false, reason: 'account-mismatch' },
    });
  });

  it('拿不到账号身份时拒绝——宁可让用户重新绑定，也不赌', () => {
    const deps = createDeps();
    new OtaReauthDispatcher(deps);

    deps.tabEventBus.emitCredentialChecked(
      fakeEvent({
        outcome: { kind: 'checked', credential: credential({ channelAccountId: null }) },
      }),
    );

    expect(deps.notify).toHaveBeenCalledWith({
      requestId: 'req-1',
      kind: 'reauth-ota',
      payload: { ok: false, reason: 'identity-unavailable' },
    });
  });

  it('credential 为 null 时同样拒绝', () => {
    const deps = createDeps();
    new OtaReauthDispatcher(deps);

    deps.tabEventBus.emitCredentialChecked(
      fakeEvent({ outcome: { kind: 'checked', credential: null } }),
    );

    expect(deps.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { ok: false, reason: 'identity-unavailable' },
      }),
    );
  });

  it('标签页已关闭时什么都不发', () => {
    const deps = createDeps();
    new OtaReauthDispatcher(deps);

    deps.tabEventBus.emitCredentialChecked(
      fakeEvent({ webContents: { isDestroyed: () => true } as never }),
    );

    expect(deps.notify).not.toHaveBeenCalled();
  });

  it('不是重新登录意图时完全不参与', () => {
    const deps = createDeps();
    new OtaReauthDispatcher(deps);

    deps.tabEventBus.emitCredentialChecked(
      fakeEvent({ intent: { kind: 'bind-hotel', requestId: 'req-2' } }),
    );
    deps.tabEventBus.emitCredentialChecked(fakeEvent({ intent: undefined }));

    expect(deps.notify).not.toHaveBeenCalled();
  });

  it('登录判定尚未完成时不表态', () => {
    const deps = createDeps();
    new OtaReauthDispatcher(deps);

    deps.tabEventBus.emitCredentialChecked(
      fakeEvent({ outcome: { kind: 'not-yet-past-login' } }),
    );

    expect(deps.notify).not.toHaveBeenCalled();
  });
});
