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
 *
 * ## 检查时机
 *
 * ```
 * 登录（首次）        → 立即检查
 * 之后每 2h + [0,1h)  → 定时复查
 * ```
 *
 * 只在登录时查一次是不够的：应用常被连开数天不退出（酒店前台尤其如此），
 * 那类机器永远发现不了新版本。抖动是为了让集中部署的机器不要同相位齐刷刷
 * 打 OSS。
 */
import type { StaffIdentity } from '@hotel-butler/api';
import type { ErrorReporter } from '../error-reporting/error-reporter';
import { isNewerVersion } from '../updater/compare-versions';
import {
  isPhoneAllowed,
  parseGrayReleaseManifest,
  type GrayReleaseManifest,
} from '../updater/gray-release-manifest';
import type { AppLogger } from '../../shared/logging';
import { safeLogErrorDetails } from '../../shared/logging';
import type { ManualUpdate } from '../../shared/updater';

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
  /** 决定命中名单后走自动更新还是只提示：只有 win32 能自动更新。 */
  platform: NodeJS.Platform;
  /** 本机 CPU 架构（`process.arch`），用于在 Mac 上挑对应的下载包。 */
  arch: string;
  /** 本机当前版本（`app.getVersion()`），非 win32 平台用它比对 manifest 里的最新版。 */
  currentVersion: string;
  fetchManifest: (url: string) => Promise<unknown>;
  /** 下载完成后通知渲染进程（仅 win32）。 */
  onUpdateReady: () => void;
  /** 有新版本但本平台不能自动更新，提示用户手动下载（非 win32）。 */
  onManualUpdateAvailable: (update: ManualUpdate) => void;
  logger: AppLogger;
  reportError: ErrorReporter;
  /**
   * 定时复查的调度原语，注入而非直接用全局 `setTimeout`：间隔以小时计，
   * 测试不可能真等，只能靠假时钟推进。
   */
  setTimer?: (callback: () => void, delayMs: number) => NodeJS.Timeout;
  clearTimer?: (timer: NodeJS.Timeout) => void;
  /**
   * 抖动用的随机源（返回 `[0, 1)`），注入是为了让"间隔落在预期区间"可断言。
   */
  random?: () => number;
}>;

const OPERATION = 'update-check';

/** 定时复查的基础间隔：2 小时。 */
export const RECHECK_BASE_MS = 2 * 60 * 60 * 1000;

/**
 * 在基础间隔上再加 `[0, 1)` 小时的随机抖动。
 *
 * 没有抖动的话，所有客户端会按各自启动时刻形成固定节拍——同一批装机的机器
 * （比如集中部署的门店）会长期保持同相位，每 2 小时齐刷刷打一次 OSS。抖动
 * 让它们逐渐散开。
 */
export const RECHECK_JITTER_MS = 60 * 60 * 1000;

export class UpdaterService {
  /**
   * 登录触发的首次检查是否已经做过。
   *
   * 触发点有三个（login / loginWithPhoneCode / currentSession），冷启动恢复会话后
   * 用户又主动刷新时会连着触发两次；没有这个标志就会重复下载。
   *
   * **它只挡登录这一串触发，不挡定时复查**——后者走 `runCheck`，不看这个标志。
   */
  private checked = false;

  private listenersAttached = false;

  /** 定时复查的句柄；`null` 表示尚未启动或已停止。 */
  private recheckTimer: NodeJS.Timeout | null = null;

  /**
   * 定时复查用的身份。名单按手机号判定，复查时没有新的登录事件可用，
   * 只能沿用最后一次已知身份。
   */
  private lastIdentity: StaffIdentity | null = null;

  private disposed = false;

  /** Squirrel 是否已经把包下好（仅 win32 会置位）。 */
  private updateAlreadyDownloaded = false;

  constructor(private readonly deps: UpdaterServiceDependencies) {}

  /**
   * 登录后调用。任何失败都只记录，不抛。
   *
   * 判定顺序：平台 → 更新源 → 手机号 → 名单 → 启动 Squirrel。
   * 任一不满足即静默返回。
   *
   * 首次检查之后会挂上定时复查——应用常被连开数天不退出（酒店前台尤其如此），
   * 只在登录时查一次意味着这类机器永远发现不了新版本。
   */
  async checkOnce(identity: StaffIdentity): Promise<void> {
    if (this.checked) return;
    this.checked = true;

    await this.runCheck(identity);
    this.scheduleRecheck();
  }

  /**
   * 一次检查的完整流程。`checkOnce` 与定时复查共用，区别只在谁来调。
   */
  private async runCheck(identity: StaffIdentity): Promise<void> {
    const { feedUrl, manifestUrl, salt, logger } = this.deps;

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

    // 复查时没有新的登录事件，名单判定只能沿用这份身份。
    this.lastIdentity = identity;

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

      /**
       * 灰度判定对所有平台一致，分歧只在"命中之后做什么"：
       *
       * ```
       * win32   → Squirrel 静默下载、退出时安装
       * 其他     → 只提示"有新版本，去下载"，人工装
       * ```
       *
       * macOS 走不了自动更新：更新替换要求新旧产物签名身份一致，而本项目不做
       * 代码签名。启动 Squirrel 只会产生必然失败的噪声，所以连试都不试。
       */
      if (this.deps.platform === 'win32') {
        this.attachListeners();
        this.deps.autoUpdater.setFeedURL({ url: feedUrl });
        this.deps.autoUpdater.checkForUpdates();
        logger.info('Update check started', { feedUrl });
        return;
      }

      this.notifyManualUpdate(manifest);
    } catch (error) {
      this.reportFailure(error, 'Update check failed');
    }
  }

  /**
   * 不能自动更新的平台：比对版本号，有新版才提示。
   *
   * 名单里没写 `latestVersion` 时什么都不做——Windows 的更新不依赖这个字段，
   * 发版时容易漏填，不该因此弹一个内容不明的通知。
   */
  private notifyManualUpdate(manifest: GrayReleaseManifest): void {
    const { logger } = this.deps;
    const latestVersion = manifest.latestVersion?.trim();
    if (!latestVersion) {
      logger.info('Manifest has no latestVersion; skipping manual update notice');
      return;
    }

    const currentVersion = this.deps.currentVersion;
    if (!isNewerVersion(latestVersion, currentVersion)) {
      logger.info('Already up to date', { currentVersion, latestVersion });
      return;
    }

    /**
     * 按本机架构挑下载地址。挑不到就只报版本号、不给跳转入口——给错架构的包
     * 比不给更糟：用户下回来打不开，还以为是应用坏了。
     */
    const { arch } = this.deps;
    const downloadUrl =
      (arch === 'arm64' || arch === 'x64' ? manifest.downloadUrls?.[arch]?.trim() : undefined) ||
      null;
    if (downloadUrl === null) {
      logger.info('No download URL for this architecture', { arch });
    }

    logger.info('Manual update available', { currentVersion, latestVersion, arch });
    try {
      this.deps.onManualUpdateAvailable({ latestVersion, downloadUrl });
    } catch (error) {
      this.reportFailure(error, 'Could not notify the renderer about the manual update');
    }
  }

  /**
   * 排一次定时复查。每次只排一个，回调里再排下一个——用 `setTimeout` 链而非
   * `setInterval`：抖动要求每一轮的间隔都不同，`setInterval` 只能是固定周期。
   */
  private scheduleRecheck(): void {
    const { setTimer, logger } = this.deps;
    if (setTimer === undefined || this.disposed) return;
    // 更新源没配（dev / pre）时首次检查就返回了，没必要空转定时器。
    if (this.deps.feedUrl === null) return;
    if (this.recheckTimer !== null) return;

    const random = this.deps.random ?? Math.random;
    const delayMs = RECHECK_BASE_MS + Math.floor(random() * RECHECK_JITTER_MS);

    this.recheckTimer = setTimer(() => {
      this.recheckTimer = null;
      void this.recheck();
    }, delayMs);

    logger.info('Next update check scheduled', { delayMs });
  }

  private async recheck(): Promise<void> {
    if (this.disposed) return;

    const identity = this.lastIdentity;
    /**
     * 没有可用身份说明首次检查在拿到手机号之前就返回了（未配更新源、无手机号）。
     * 那些前提不会因为时间流逝而改变，继续排队只是空转。
     */
    if (identity === null) return;

    /**
     * Windows 上包已经下好了就不必再查：Squirrel 的安装发生在退出时，在那之前
     * 重复检查既不会让它提前装，也只是往 OSS 多打一次请求。
     */
    if (this.updateAlreadyDownloaded) {
      this.deps.logger.info('Update already downloaded; skipping recheck');
      return;
    }

    await this.runCheck(identity);
    this.scheduleRecheck();
  }

  /** 停止定时复查。进程退出前由 composition root 调用。 */
  dispose(): void {
    this.disposed = true;
    if (this.recheckTimer !== null) {
      this.deps.clearTimer?.(this.recheckTimer);
      this.recheckTimer = null;
    }
  }

  private attachListeners(): void {
    if (this.listenersAttached) return;
    this.listenersAttached = true;

    this.deps.autoUpdater.onUpdateDownloaded(() => {
      this.updateAlreadyDownloaded = true;
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
