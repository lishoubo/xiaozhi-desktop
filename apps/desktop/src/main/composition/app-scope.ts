/**
 * 进程级依赖 —— 从应用启动活到退出，跨窗口共享。
 *
 * 与 `window-scope.ts` 的分界：能不能在关窗后继续存在？数据库连接、仓储、
 * 远端 gateway 可以（重新开窗要复用），窗口、BrowserManager、IPC handler 不行。
 * 此前两类混在一起，导致 21 个可空模块变量和两份彼此不一致的清理清单。
 */
import { app, autoUpdater } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { safeLogErrorDetails, type AppLogger } from '../../shared/logging';
import { SqliteCalendarRepository } from '../calendar/calendar-repository';
import { createCtripDiscovery } from '../channels/ctrip/discovery';
import { createDouyinDiscovery } from '../channels/douyin/discovery';
import { createMeituanDiscovery } from '../channels/meituan/discovery';
import { createChannelRegistry, type ChannelAdapter } from '../channels/registry';
import {
  openApplicationDatabase,
  type ApplicationDatabase,
} from '../database/application-database';
import { SqliteOtaCredentialRepository } from '../database/ota-credential-repository';
import { SqliteOtaHotelRepository } from '../database/ota-hotel-repository';
import { readOrCreateDeviceId } from '../file-store/device-id';
import { updatePartitionState } from '../file-store/partition-ledger';
import {
  cleanupOrphanPartitions,
  cleanupRetiredPartitions,
} from '../browser/partition-cleanup';
import { reportError } from '../error-reporting/report-error';
import { HttpRmsHotelGateway } from '../gateway/rms/rms-hotel-gateway-http';
import { HttpRmsOtaAccountGateway } from '../gateway/rms/rms-ota-account-gateway-http';
import type { ChannelId } from '../ids';
import { SessionFactory } from '../browser/session-factory';
import { collectCookieSnapshot } from '../browser/cookie-snapshot/collect-cookie-snapshot';
import { createElectronSessionFetch } from '../server-client/trpc-client';
import { createAuthenticatedRmsFetch } from '../staff-auth/authenticated-rms-fetch';
import { createRmsAuthClient } from '../staff-auth/rms-auth-client';
import { resolveRmsOrigin } from '../staff-auth/rms-endpoint';
import { createRmsTokenProvider, type RmsTokenProvider } from '../staff-auth/rms-token-provider';
import { createStaffTokenStore } from '../staff-auth/token-store';
import { HotelManagementService } from '../services/hotel-management-service';
import { OtaCredentialService } from '../services/ota-credential-service';
import { UpdaterService } from '../services/updater-service';
import {
  resolveGrayReleaseManifestUrl,
  resolveUpdateFeedUrl,
  resolveUpdateSalt,
} from '../updater/update-endpoint';
import {
  createWindowCapabilityRegistry,
  type WindowCapabilityRegistry,
} from './window-capability-registry';

export type AppScope = Readonly<{
  logger: AppLogger;
  userDataDir: string;
  database: ApplicationDatabase;
  sessionFactory: SessionFactory;
  calendarRepository: SqliteCalendarRepository;
  otaCredentialRepository: SqliteOtaCredentialRepository;
  otaHotelRepository: SqliteOtaHotelRepository;
  hotelManagementService: HotelManagementService;
  otaCredentialService: OtaCredentialService;
  /**
   * 自动更新。进程级而非窗口级：下载在后台进行，跨关窗要继续；"已就绪待重启"
   * 的状态也不能因重开窗口而丢。
   */
  updaterService: UpdaterService;
  channelRegistry: ReadonlyMap<ChannelId, ChannelAdapter>;
  /** rms-server 的认证栈——`StaffAuthService` 与业务 gateway 共用同一份。 */
  rms: Readonly<{
    origin: string;
    authClient: ReturnType<typeof createRmsAuthClient>;
    tokens: RmsTokenProvider;
    /** 已注入 Bearer / UA、并在 401 时重试一次的 fetch。 */
    fetch: typeof globalThis.fetch;
  }>;
  windowCapabilities: WindowCapabilityRegistry;
  /** 启动时回收退休与孤儿 partition；失败不阻断启动。 */
  cleanupPartitionsOnStartup(): Promise<void>;
  /**
   * 由 window scope 回填：绑定流程要开 OTA 标签页，而 `OtaTabService` 依赖
   * 窗口级的 `BrowserManager`。窗口不存在时调用会明确失败，不静默吞掉。
   */
  dispose(): void;
}>;

export function createAppScope(logger: AppLogger): AppScope {
  const userDataDir = app.getPath('userData');
  const database = openApplicationDatabase(path.join(userDataDir, 'hotel-butler.sqlite'), logger, {
    includeMockData: !app.isPackaged,
  });

  const sessionFactory = new SessionFactory(logger);

  /**
   * 绑定时给远端的 cookie 快照：调用瞬间从该 partition 的实时登录态读取，
   * 不落本地、不记日志（日志只记条数与采集方式）。
   *
   * 优先走 CDP —— 只有它能拿到 CHIPS 分区键（`session.cookies.get()` 的返回结构里
   * 根本没有这个字段），而分区与非分区的同名 cookie 在远端按
   * `(name,domain,path,partitionKey)` 去重，分不清就会塌缩成一条、丢掉登录票据。
   *
   * CDP 需要一个标签页 webContents，由窗口能力提供；窗口或标签页不在时降级到
   * Electron API，绝不让绑定流程因采集失败而中断。
   *
   * ⚠️ 抖音在**当前绑定路径下不产生分区 cookie**（落地页始终是 `life.douyin.com`，
   * 顶级站点从未变成 `douyin.com`，见 `openspec/changes/desktop-cookie-field-completion/
   * verification.md`）。走 CDP 仍是对的 —— 罐子里有就一定取到；这里只是说明为什么
   * 抖音实测 `partitionedCount` 是 0，不代表采集失效。
   */
  const readCookieSnapshot = (partitionName: string) =>
    collectCookieSnapshot({
      partitionName,
      session: sessionFactory.sessionForAccount(partitionName),
      // 窗口尚未就绪时视作「没有标签页」，与用户提前关掉标签页同样处理
      webContentsForPartition: (name) =>
        windowCapabilities.current()?.webContentsForPartition(name) ?? null,
      logger,
    });

  const calendarRepository = new SqliteCalendarRepository(database);
  const otaCredentialRepository = new SqliteOtaCredentialRepository(database);
  const otaHotelRepository = new SqliteOtaHotelRepository(database);

  /**
   * RMS 认证栈。放在进程级而非窗口级，是因为 gateway 也活在这一层——
   * token 的读写、刷新和并发去重必须只有一份，否则多个 gateway 同时撞上过期
   * 会各刷一次，而 RMS 的 refresh token 是单次使用的。
   */
  const rmsOrigin = resolveRmsOrigin();
  const rmsFetch = createElectronSessionFetch(sessionFactory.sessionForRmsApi());
  // 只读一次盘：认证请求可能并发，惰性 + 记忆化避免每次请求都去碰文件。
  let deviceIdPromise: Promise<string> | null = null;
  const deviceId = (): Promise<string> => {
    deviceIdPromise ??= readOrCreateDeviceId(userDataDir, logger);
    return deviceIdPromise;
  };
  const rmsAuthClient = createRmsAuthClient({
    origin: rmsOrigin,
    fetch: rmsFetch,
    logger,
    appVersion: app.getVersion(),
    deviceId,
  });
  const rmsTokens = createRmsTokenProvider({
    tokenStore: createStaffTokenStore({ userDataDir, logger }),
    client: rmsAuthClient,
    now: () => Date.now(),
    logger,
  });
  /** 业务 gateway 的请求出口：拿到它就只写业务请求，不必碰 token。 */
  const authenticatedRmsFetch = createAuthenticatedRmsFetch({
    fetch: rmsFetch,
    provider: rmsTokens,
    logger,
  });

  const windowCapabilities = createWindowCapabilityRegistry();

  const otaCredentialService = new OtaCredentialService({
    discoverCtrip: createCtripDiscovery(logger),
    discoverDouyin: createDouyinDiscovery(logger),
    discoverMeituan: createMeituanDiscovery(logger),
    credentialRepository: otaCredentialRepository,
    generateCredentialId: () => randomUUID(),
    // 探测成功 = 这份 partition 被某条 credential 认领了。此前这里是把它从
    // 「待认领」清单里删掉（记录随之消失、无从追溯），现在改为推进状态。
    markPartitionClaimed: (partitionName, credentialId) =>
      updatePartitionState(userDataDir, partitionName, { kind: 'claimed', credentialId }),
    onCredentialPartitionReplaced: async (previousPartitionName) => {
      // 先落账本再清理：清理可能因「仍有标签页占用」而推迟，甚至跨重启才完成。
      // 只记在内存里的话，重启后这份 partition 就永远没人清了（旧实现的缺陷）。
      await updatePartitionState(userDataDir, previousPartitionName, {
        kind: 'retired',
        retiredAt: new Date().toISOString(),
      });
      await windowCapabilities.requireCurrent().retirePartition(previousPartitionName);
    },
    logger,
    onAccountBound: (channel) => windowCapabilities.requireCurrent().notifyAccountBound(channel),
  });

  const updaterService = new UpdaterService({
    // 把 Electron 的重载式 `on(event, listener)` 适配成两个窄方法。service 只
    // 关心"下载完了"和"出错了"，listener 的其余形参一个都用不到。
    autoUpdater: {
      setFeedURL: (options) => autoUpdater.setFeedURL(options),
      checkForUpdates: () => autoUpdater.checkForUpdates(),
      onUpdateDownloaded: (listener) => {
        autoUpdater.on('update-downloaded', () => listener());
      },
      onError: (listener) => {
        autoUpdater.on('error', listener);
      },
    },
    feedUrl: resolveUpdateFeedUrl(),
    manifestUrl: resolveGrayReleaseManifestUrl(),
    salt: resolveUpdateSalt(),
    platform: process.platform,
    arch: process.arch,
    currentVersion: app.getVersion(),
    fetchManifest: async (url) => {
      /**
       * 更新源是公共读的 OSS，不带凭证、不复用 `authenticatedRmsFetch`——
       * 那条链会注入 Bearer，往对象存储发凭证没有必要。
       *
       * `cache: 'no-store'`：名单改了要立刻生效，CDN/本地缓存会让灰度调整
       * 延迟数小时才被客户端看到。
       */
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Gray release manifest request failed: ${response.status}`);
      }
      return response.json();
    },
    // 用 current() 而非 requireCurrent()：下载完成时窗口可能已关，送不到是正常的。
    onUpdateReady: () => windowCapabilities.current()?.notifyUpdateReady(),
    onManualUpdateAvailable: (update) => windowCapabilities.current()?.notifyManualUpdate(update),
    /**
     * 定时复查用的调度原语。`unref()` 让这个定时器不成为事件循环的存活理由——
     * 否则没有窗口时进程会被它吊着不退出。
     */
    setTimer: (callback, delayMs) => setTimeout(callback, delayMs).unref(),
    clearTimer: (timer) => clearTimeout(timer),
    logger,
    reportError,
  });

  return {
    logger,
    userDataDir,
    database,
    sessionFactory,
    calendarRepository,
    otaCredentialRepository,
    otaHotelRepository,
    hotelManagementService: new HotelManagementService({
      hotelGateway: new HttpRmsHotelGateway({
        origin: rmsOrigin,
        fetch: authenticatedRmsFetch,
        logger,
        reportError,
      }),
      otaAccountGateway: new HttpRmsOtaAccountGateway({
        origin: rmsOrigin,
        fetch: authenticatedRmsFetch,
        logger,
        reportError,
      }),
      otaHotelRepository,
      otaCredentialRepository,
      readCookieSnapshot: (partitionName) => readCookieSnapshot(partitionName),
      generateRequestId: () => randomUUID(),
      logger,
    }),
    otaCredentialService,
    updaterService,
    channelRegistry: createChannelRegistry(logger),
    windowCapabilities,
    rms: {
      origin: rmsOrigin,
      authClient: rmsAuthClient,
      tokens: rmsTokens,
      fetch: authenticatedRmsFetch,
    },
    /**
     * 启动时回收 partition。放在这里而不是 `index.ts`：那是进程入口，不含业务
     * 装配。此刻还没有任何标签页，「有没有人在用」的守卫天然满足，是最安全的时机。
     *
     * 两步都以 credential 表为准（账本只是索引）：
     * 1. 账本里 `retired` 的 → 清空
     * 2. 账本外的孤儿（磁盘上有目录、无人认领）→ 清空
     *
     * 失败只记日志，绝不阻断启动 —— 清理是卫生工作，不该让用户打不开应用。
     */
    async cleanupPartitionsOnStartup() {
      const isPartitionClaimed = (partitionName: string): boolean =>
        otaCredentialRepository.findByPartitionName(partitionName) !== null;
      const clearPartitionStorage = (partitionName: string): Promise<void> =>
        sessionFactory.clearAccountSession(partitionName);

      try {
        await cleanupRetiredPartitions({
          userDataDir,
          isPartitionClaimed,
          clearPartitionStorage,
          logger,
        });
        await cleanupOrphanPartitions({
          userDataDir,
          isPartitionClaimed,
          clearPartitionStorage,
          logger,
        });
      } catch (error) {
        logger.warn('Partition cleanup failed at startup', {
          error: safeLogErrorDetails(error),
        });
      }
    },
    dispose() {
      updaterService.dispose();
      database.close();
      logger.info('Application database closed');
    },
  };
}
