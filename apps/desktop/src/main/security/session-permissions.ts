import type { Session } from 'electron';

type PermissionSession = Pick<Session, 'setPermissionCheckHandler' | 'setPermissionRequestHandler'>;

export function denyEmbeddedPagePermissions(browserSession: PermissionSession): void {
  browserSession.setPermissionCheckHandler(() => false);
  browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
}
