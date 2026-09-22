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
import { AppConfigStore } from '../app-config/app-config-store';
import {
  openApplicationDatabase,
  type ApplicationDatabase,
} from '../database/application-database';
import { SqliteOtaCredentialRepository } from '../database/ota-credential-repository';
import { SqliteOtaHotelRepository } from '../database/ota-hotel-repository';
import { SqliteOtaInventorySnapshotRepository } from '../database/ota-inventory-snapshot-repository';
import { SnapshotCleaner } from '../inventory-snapshot/snapshot-cleaner';
import { SnapshotWriteQueue } from '../inventory-snapshot/snapshot-write-queue';
import { createScanResultHandler } from '../inventory-snapshot/scan-to-report';
import { readCtripQuantity, readMeituanQuantity } from '../inventory-snapshot/quantity-reading';
import { mapCtripReadRows } from '../inventory-snapshot/ctrip-cells';
import { InventoryScanDispatcher, type ScanTarget } from '../channels/inventory-scan-dispatcher';
import { inventoryScans } from '../channels/registry';
import { buildCtripScanReport } from '../channels/ctrip/inventory-scan-payload';
import { buildMeituanScanReport } from '../channels/meituan/inventory-scan-payload';
import { mapMeituanReadRows } from '../inventory-snapshot/meituan-cells';
import { AmountChangeReportService } from '../services/amount-change-report-service';
import { HttpRmsAmountChangeGateway } from '../gateway/rms/rms-amount-change-gateway-http';
import { StaffAuthService } from '../services/staff-auth-service';
import { createScanTargetsOf } from './scan-targets';
import { readOrCreateDeviceId } from '../file-store/device-id';
import { updatePartitionState } from '../file-store/partition-ledger';
import { cleanupOrphanPartitions, cleanupRetiredPartitions } from '../browser/partition-cleanup';
import { reportError } from '../error-reporting/report-error';
import { HttpRmsHotelGateway } from '../gateway/rms/rms-hotel-gateway-http';
import { HttpRmsOtaAccountGateway } from '../gateway/rms/rms-ota-account-gateway-http';
import { toChannelId, type ChannelId } from '../ids';
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
  /**
   * 价量态基线快照的写入队列。**进程级而非窗口级**：快照跨窗口共享，且定时扫描
   * （Change B）的生命周期长于任何单个窗口 —— 窗口关闭只该摘掉投递方，队列本身不停。
   */
  snapshotWriteQueue: SnapshotWriteQueue;
  hotelManagementService: HotelManagementService;
  otaCredentialService: OtaCredentialService;
  /**
   * 自动更新。进程级而非窗口级：下载在后台进行，跨关窗要继续；"已就绪待重启"
   * 的状态也不能因重开窗口而丢。
   */
  updaterService: UpdaterService;
  /**
   * 运行期可调参数。进程级：与窗口生命周期无关，将来接服务端下发时下发的值也该跨窗口
   * 共享。当前只有内置默认值一层，见 `app-config/types.ts`。
   */
  appConfig: AppConfigStore;
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
   * 启动后台快照清理。**窗口创建之后调用** —— 首轮自带延迟，不与启动阶段的 IPC、
   * 页面加载抢事件循环。
   */
  startBackgroundCleanup(): void;
  /**
   * 由 window scope 回填：绑定流程要开 OTA 标签页，而 `OtaTabService` 依赖
   * 窗口级的 `BrowserManager`。窗口不存在时调用会明确失败，不静默吞掉。
   */
  dispose(): void;
}>;

/** 扫描的枚举口径按渠道分流，见 `scanTargetsOf`。 */
const MEITUAN_CHANNEL = toChannelId('meituan');

export function createAppScope(logger: AppLogger): AppScope {
  const userDataDir = app.getPath('userData');
  // 本期只有内置默认值层；服务端下发与本地覆盖的来源将来加在这个构造参数里。
  const appConfig = new AppConfigStore();
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
  const snapshotRepository = new SqliteOtaInventorySnapshotRepository(database);
  // 过期格子清理。**这里只构造，不启动** —— 启动在 `startBackgroundCleanup()`，由
  // `index.ts` 在窗口创建之后调用。
  //
  // ⚠️ 不要挪回这里同步执行（曾经就是那样）：此刻数据库刚打开、窗口还没创建，一次无界
  // 同步 DELETE 卡多久，窗口就晚出来多久。理由详见 `snapshot-cleaner.ts` 的文件头。
  const snapshotCleaner = new SnapshotCleaner({
    deleteOlderThan: (beforeDate, limit) => snapshotRepository.deleteOlderThan(beforeDate, limit),
    logger,
    config: () => appConfig.get().snapshotCleanup,
  });
  // 队列只认一个「写」回调 —— 它不该知道 repository 的其余方法（读基线、清理都不归它管）。
  const snapshotWriteQueue = new SnapshotWriteQueue({
    write: (cells) => snapshotRepository.upsertMany(cells),
    logger,
  });

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

  const scanTargetsOf = createScanTargetsOf({ meituanChannel: MEITUAN_CHANNEL, logger });

  // 用账号会话发请求：`session.fromPartition()` 的唯一持有者是 session-factory，
  // 渠道层够不着，所以在这里兑换成一个只能发请求的窄函数。
  const scanFetcher = async (
    partitionName: string,
    url: string,
    body: Record<string, unknown> | null,
    headers: Readonly<Record<string, string>>,
    timeoutMs: number,
  ): Promise<unknown> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await sessionFactory.sessionForAccount(partitionName).fetch(url, {
        // body 为 null 即 GET —— 美团的门店列表端点是 GET，其余都是 POST。
        method: body === null ? 'GET' : 'POST',
        // 让 Chromium 自己从该 partition 的 cookie jar 带 cookie —— 不手拼 Cookie 头。
        credentials: 'include',
        headers,
        ...(body === null ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      const text = await response.text();
      // ⚠️ **HTTP 状态原样回传，不替渠道翻译成业务码**。
      //
      // 这个 fetcher 服务所有渠道，而「HTTP 401 等价于业务码 401」只对携程成立
      // （它的 `EXPIRED_CODES` 里恰好有 401）。美团的业务码空间里 401 是另一回事 ——
      // 翻译过去会让一个正常的业务错误被误报成登录失效。归一由各渠道的判据自己做。
      if (response.status === 403) return { __httpStatus: 403 };
      if (response.status === 401) return { __httpStatus: 401 };
      if (!response.ok) return null;
      try {
        return JSON.parse(text);
      } catch {
        // 解析不了就回传原文 —— 登录失效时携程返回 200 + 整页登录页 HTML，
        // 那种情况必须让判据看到原文，不能吞成 null。
        return text;
      }
    } catch (error) {
      // ⚠️ 超时与网络失败都回 null（调用方判成 NETWORK_ERROR），但要留一条日志 ——
      // 否则「cookie 失效」「渠道超时」「断网」在 GlitchTip 里长得一模一样。
      logger.warn('Ctrip scan fetch failed', {
        url,
        timedOut: controller.signal.aborted,
        error: safeLogErrorDetails(error),
      });
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  // 每次取值时才读配置 —— 将来接服务端下发时，运行中改的值才能被读到。
  const channelRegistry = createChannelRegistry(logger, () => appConfig.get(), scanFetcher);

  // ── 价量态定时扫描 ──────────────────────────────────────────────────────────
  // 建在 app-scope 而非 window-scope：对账不该因为用户关了窗口就停。
  //
  // 上报服务在这里**另建一份**（window-scope 里那份服务的是改价/回读链路）。两份
  // 各自生成 operationId，本就不该互相去重 —— 它们是不同的事实。
  const scanReportService = new AmountChangeReportService({
    gateway: new HttpRmsAmountChangeGateway({
      origin: rmsOrigin,
      fetch: authenticatedRmsFetch,
      logger,
      reportError,
    }),
    identity: {
      currentStaff: async () => {
        const identity = await new StaffAuthService({
          client: rmsAuthClient,
          tokens: rmsTokens,
          logger,
        }).currentSession();
        if (!identity) return null;
        return {
          userId: identity.userId,
          username: identity.username,
          fullName: identity.fullName,
        };
      },
      credentialByPartition: (partitionName) => {
        const credential = otaCredentialRepository.findByPartitionName(partitionName);
        return Promise.resolve(
          credential
            ? {
                channelAccountId: credential.channelAccountId,
                credentialExtra: credential.credentialExtra,
              }
            : null,
        );
      },
    },
    logger,
  });

  const inventoryScanDispatcher = new InventoryScanDispatcher({
    scans: inventoryScans(channelRegistry),
    logger,
    // ⚠️ 每轮重新读配置 —— 构造时取一次会让服务端下发要等重启才生效。
    config: () => {
      const scan = appConfig.get().inventoryScan;
      // ⚠️ `byHotel` 的键必须带渠道：`otaHotelId` 取自各渠道自己的 `masterHotelId`，
      // 只在渠道内唯一。用裸 ID 做键，两个渠道的同号门店会互相影响 —— 关掉携程某家店
      // 会连带关掉美团同号的无关门店，而这个开关存在的理由正是「只关那一个」。
      const scopeOf = (channel: string, otaHotelId: string) => ({
        channel: scan.channels[channel],
        hotel: scan.byHotel[`${channel}:${otaHotelId}`],
      });
      return {
        enabled: scan.enabled,
        idleMs: scan.idleMs,
        jitterMs: scan.jitterMs,
        windowDays: scan.windows.days,
        // ⚠️ 未列出的渠道 = 关（接渠道是开发行为，必须显式开）。
        isChannelEnabled: (channel) => scan.channels[channel]?.enabled === true,
        // ⚠️ 未列出的酒店 = 取上层值（酒店是用户动态绑的，要求显式登记会让新店静默不扫）。
        isHotelEnabled: (channel, otaHotelId) => {
          const { channel: channelScope, hotel } = scopeOf(channel, otaHotelId);
          return hotel?.enabled ?? channelScope?.enabled ?? false;
        },
      };
    },
    listTargets: () => {
      const targets: ScanTarget[] = [];
      for (const channel of channelRegistry.keys()) {
        for (const credential of otaCredentialRepository.listByChannel(channel)) {
          targets.push(...scanTargetsOf(channel, credential));
        }
      }
      return targets;
    },
    onRows: createScanResultHandler({
      // ⚠️ 与 window-scope 的自然读链注册的是**同一批函数** —— 两条写入路径共用一份
      // 映射，各写一份的话同一格会被写成不同内容，定时扫描于是反复报差异。
      mappers: new Map([
        ['ctrip', mapCtripReadRows],
        ['meituan', mapMeituanReadRows],
      ]),
      reportBuilders: new Map([
        [
          'ctrip',
          (otaHotelId, cells, probedAt) =>
            buildCtripScanReport(toChannelId('ctrip'), otaHotelId, cells, probedAt),
        ],
        [
          'meituan',
          (otaHotelId, cells, probedAt) =>
            buildMeituanScanReport(MEITUAN_CHANNEL, otaHotelId, cells, probedAt),
        ],
      ]),
      // 房量上报判据用的渠道口径。⚠️ 漏注册的渠道会退回「变了就报」，
      // 失效方向是多报而不是漏报（见 `inventory-report-gate.ts`）。
      quantityReaders: new Map([
        ['ctrip', readCtripQuantity],
        ['meituan', readMeituanQuantity],
      ]),
      readBaseline: (source, otaHotelId, startDate, endDate) =>
        snapshotRepository.findByHotelAndDateRange(source, otaHotelId, startDate, endDate),
      enqueue: (cells) => snapshotWriteQueue.push(cells),
      report: (observed, partitionName) => void scanReportService.report(observed, partitionName),
      newTraceId: () => randomUUID(),
      baselineFreshnessMs: () => appConfig.get().inventoryScan.baselineFreshnessMs,
      logger,
    }),
    reportError,
  });
  inventoryScanDispatcher.start();

  return {
    logger,
    userDataDir,
    database,
    sessionFactory,
    calendarRepository,
    otaCredentialRepository,
    otaHotelRepository,
    snapshotWriteQueue,
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
    appConfig,
    // 每次取值时才读 —— 将来接服务端下发时，运行中改的值才能被读到。
    channelRegistry,
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
    startBackgroundCleanup() {
      snapshotCleaner.start(appConfig.get().snapshotCleanup.startupDelayMs);
    },

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
      inventoryScanDispatcher.dispose();
      snapshotCleaner.dispose();
      // 必须在 database.close() 之前：队列里可能还压着没写的格子，
      // 让它先停掉消费，避免往一个已关闭的连接上写。
      snapshotWriteQueue.dispose();
      database.close();
      logger.info('Application database closed');
    },
  };
}
