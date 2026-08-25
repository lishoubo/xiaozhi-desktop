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

/** `electron.shell` 里用到的唯一一个方法。 */
export type SystemShell = Readonly<{
  openPath: (target: string) => Promise<string>;
}>;

export type SystemServiceDependencies = Readonly<{
  app: SystemApp;
  shell: SystemShell;
  logsDirectory: string;
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

  /**
   * 在系统文件管理器里打开日志目录。
   *
   * Windows 上日志埋在 `%APPDATA%\<环境专属应用名>\logs\<变体>\`，让测试同学
   * 照着路径一层层点进去既慢又容易走错环境（三套包能并存安装，目录名只差几个字）。
   *
   * `shell.openPath` 失败不抛异常，而是**返回一个非空错误串**——这是 Electron 的
   * 约定，不是笔误。
   */
  async openLogsDirectory(): Promise<void> {
    const failure = await this.deps.shell.openPath(this.deps.logsDirectory);
    if (failure) {
      this.deps.logger.warn('Could not open logs directory', {
        logsDirectory: this.deps.logsDirectory,
        failure,
      });
      throw new Error(`无法打开日志目录：${failure}`);
    }
    this.deps.logger.info('Logs directory opened', { logsDirectory: this.deps.logsDirectory });
  }
}
