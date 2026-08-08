/**
 * 系统偏好设置 —— 开机自启开关与版本号。
 *
 * 这里是 `electron.app` 在 IPC 链路上的唯一落点：把它收在 service 里，
 * `ipc/` 才能守住「除 ipcMain 外不碰 electron」这条准入标准。
 */
import type { SystemPreferences } from '../../shared/browser';
import type { AppLogger } from '../../shared/logging';

/** 只声明用到的那几个 app 能力，便于测试替换。 */
export type SystemApp = Readonly<{
  getLoginItemSettings: () => Readonly<{ openAtLogin: boolean }>;
  getVersion: () => string;
  setLoginItemSettings: (settings: Readonly<{ openAtLogin: boolean }>) => void;
}>;

export type SystemServiceDependencies = Readonly<{
  app: SystemApp;
  logger: AppLogger;
}>;

export class SystemService {
  constructor(private readonly deps: SystemServiceDependencies) {}

  getPreferences(): SystemPreferences {
    return {
      autoLaunch: this.deps.app.getLoginItemSettings().openAtLogin,
      version: this.deps.app.getVersion(),
    };
  }

  setAutoLaunch(enabled: boolean): SystemPreferences {
    this.deps.app.setLoginItemSettings({ openAtLogin: enabled });
    this.deps.logger.info('Auto-launch preference changed', { enabled });
    return this.getPreferences();
  }
}
