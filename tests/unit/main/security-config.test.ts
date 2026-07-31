import { describe, expect, it, vi } from 'vitest';
import { configureNetworkPrivacy } from '../../../src/main/security/network-privacy';
import { denyEmbeddedPagePermissions } from '../../../src/main/security/session-permissions';

describe('configureNetworkPrivacy', () => {
  it('prevents embedded pages from probing local interfaces over non-proxied WebRTC UDP', () => {
    const appendSwitch = vi.fn();

    configureNetworkPrivacy({ appendSwitch });

    expect(appendSwitch).toHaveBeenCalledWith(
      'force-webrtc-ip-handling-policy',
      'disable_non_proxied_udp',
    );
  });
});

describe('denyEmbeddedPagePermissions', () => {
  it('denies both permission checks and permission requests from third-party pages', () => {
    const setPermissionCheckHandler = vi.fn();
    const setPermissionRequestHandler = vi.fn();

    denyEmbeddedPagePermissions({ setPermissionCheckHandler, setPermissionRequestHandler });

    const checkHandler = setPermissionCheckHandler.mock.calls[0][0] as () => boolean;
    const requestHandler = setPermissionRequestHandler.mock.calls[0][0] as (
      webContents: unknown,
      permission: string,
      callback: (allowed: boolean) => void,
    ) => void;
    const callback = vi.fn();

    expect(checkHandler()).toBe(false);
    requestHandler(undefined, 'media', callback);
    expect(callback).toHaveBeenCalledWith(false);
  });
});
