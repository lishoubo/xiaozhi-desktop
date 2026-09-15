/**
 * 自动更新编排。
 *
 * ## 两层分工
 *
 * Squirrel 只认 feed，不认名单——`checkForUpdates()` 一旦调用，它读到 RELEASES 里
 * 有新版本就会升，没有"这次别升"的开关。所以灰度做在它外面：
 *
 * ```
 * 本 service（名单层）              Electron autoUpdater（Squirrel 层）
 * ─────────────────────            ──────────────────────────────────
 * 拉 update-manifest.json
 * 算 sha256(手机号 + 盐)
 * 在名单里？
 *    ├─ 否 → 结束，autoUpdater 从不启动
 *    └─ 是 → setFeedURL + checkForUpdates() ──→ 读 RELEASES
 *                                               下载 .nupkg、校验 SHA1
 *                                               退出时安装
 * ```
 *
 * ## 失败一律不抛
 *
 * 更新是辅助能力，任何环节出问题都不该影响应用启动与使用。所有失败路径都是
 * 「记日志 + 上报，然后静默返回」——与 `index.ts` 对待错误上报初始化的态度一致。
 *
 * ## 只升不降
 *
 * Squirrel 的安装是"解压到 app-<新版本>/ 并改快捷方式"，没有降级路径。把 RELEASES
 * 改回旧版本，已升级的机器不会退回。**灰度名单的作用是"阻止尚未升级的机器继续
 * 升级"，不是撤回已经发生的升级。**
 */
import type { StaffIdentity } from '@hotel-butler/api';
import type { ErrorReporter } from '../error-reporting/error-reporter';
import { isPhoneAllowed, parseGrayReleaseManifest } from '../updater/gray-release-manifest';
import type { AppLogger } from '../../shared/logging';
import { safeLogErrorDetails } from '../../shared/logging';

/**
 * 只声明用到的那几个 autoUpdater 能力，便于测试替换（同 SystemService.SystemApp）。
 *
 * 事件用 `onUpdateDownloaded` / `onError` 两个窄方法，而不是照搬 Electron 的
 * `on(event, listener)`：后者是重载签名且 `AutoUpdater extends EventEmitter`，
 * 想在这里复述一份必然与它对不上；而本 service 只关心"下载完了"和"出错了"
 * 两件事，listener 的那堆形参（releaseNotes / releaseDate / updateURL）一个都用不到。
 *
 * 适配发生在 composition root（`app-scope.ts`），那里本就是 electron 的落点。
 */
export type UpdaterAutoUpdater = Readonly<{
  setFeedURL: (options: Readonly<{ url: string }>) => void;
  checkForUpdates: () => void;
  onUpdateDownloaded: (listener: () => void) => void;
  onError: (listener: (error: Error) => void) => void;
}>;

export type UpdaterServiceDependencies = Readonly<{
  autoUpdater: UpdaterAutoUpdater;
  /** `null` 表示本环境不启用自动更新（dev / pre 默认如此）。 */
  feedUrl: string | null;
  manifestUrl: string | null;
  salt: string | null;
  /** 只有 win32 启动更新器：macOS 的更新替换要求签名身份一致，而本项目不做签名。 */
  platform: NodeJS.Platform;
  fetchManifest: (url: string) => Promise<unknown>;
  /** 下载完成后通知渲染进程。 */
  onUpdateReady: () => void;
  logger: AppLogger;
  reportError: ErrorReporter;
}>;

const OPERATION = 'update-check';

export class UpdaterService {
  /**
   * 单次运行只检查一次。
   *
   * 触发点有三个（login / loginWithPhoneCode / currentSession），冷启动恢复会话后
   * 用户又主动刷新时会连着触发两次；没有这个标志就会重复下载。
   */
  private checked = false;

  private listenersAttached = false;

  constructor(private readonly deps: UpdaterServiceDependencies) {}

  /**
   * 登录后调用。任何失败都只记录，不抛。
   *
   * 判定顺序：平台 → 更新源 → 手机号 → 名单 → 启动 Squirrel。
   * 任一不满足即静默返回。
   */
  async checkOnce(identity: StaffIdentity): Promise<void> {
    if (this.checked) return;

    const { platform, feedUrl, manifestUrl, salt, logger } = this.deps;

    if (platform !== 'win32') return;

    if (feedUrl === null || manifestUrl === null || salt === null) {
      logger.info('Auto update is not enabled for this build');
      return;
    }

    /**
     * 服务商员工可能没有手机号（契约里 phone 是 nullable + optional）。身份不足以
     * 参与灰度判定时保守处理：**错过一次更新的代价，远低于让名单外的机器意外升级。**
     */
    const phone = identity.phone?.trim();
    if (!phone) {
      logger.info('Skipping update check because the signed-in staff has no phone number');
      return;
    }

    this.checked = true;

    try {
      const manifest = parseGrayReleaseManifest(await this.deps.fetchManifest(manifestUrl));
      if (manifest === null) {
        logger.warn('Gray release manifest is missing or malformed; skipping update');
        return;
      }

      if (!isPhoneAllowed(manifest, phone, salt)) {
        logger.info('Not in the gray release allowlist; skipping update');
        return;
      }

      this.attachListeners();
      this.deps.autoUpdater.setFeedURL({ url: feedUrl });
      this.deps.autoUpdater.checkForUpdates();
      logger.info('Update check started', { feedUrl });
    } catch (error) {
      this.reportFailure(error, 'Update check failed');
    }
  }

  private attachListeners(): void {
    if (this.listenersAttached) return;
    this.listenersAttached = true;

    this.deps.autoUpdater.onUpdateDownloaded(() => {
      this.deps.logger.info('Update downloaded and ready to install on quit');
      try {
        this.deps.onUpdateReady();
      } catch (error) {
        this.reportFailure(error, 'Could not notify the renderer about the ready update');
      }
    });

    this.deps.autoUpdater.onError((error) => {
      this.reportFailure(error, 'Auto updater reported an error');
    });
  }

  private reportFailure(error: unknown, message: string): void {
    this.deps.logger.warn(message, { error: safeLogErrorDetails(error) });
    this.deps.reportError(error, { operation: OPERATION });
  }
}
