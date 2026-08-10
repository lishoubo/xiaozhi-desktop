/**
 * 进程级依赖 —— 从应用启动活到退出，跨窗口共享。
 *
 * 与 `window-scope.ts` 的分界：能不能在关窗后继续存在？数据库连接、仓储、
 * 远端 gateway 可以（重新开窗要复用），窗口、BrowserManager、IPC handler 不行。
 * 此前两类混在一起，导致 21 个可空模块变量和两份彼此不一致的清理清单。
 */
import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { AppLogger } from '../../shared/logging';
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
import { removePendingPartition } from '../file-store/pending-partitions-store';
import { HttpRmsHotelGateway } from '../gateway/rms/rms-hotel-gateway-http';
import { HttpRmsOtaAccountGateway } from '../gateway/rms/rms-ota-account-gateway-http';
import type { ChannelId } from '../ids';
import { SessionFactory } from '../browser/session-factory';
import { createElectronSessionFetch } from '../server-client/trpc-client';
import { createAuthenticatedRmsFetch } from '../staff-auth/authenticated-rms-fetch';
import { createRmsAuthClient } from '../staff-auth/rms-auth-client';
import { resolveRmsOrigin } from '../staff-auth/rms-endpoint';
import { createRmsTokenProvider, type RmsTokenProvider } from '../staff-auth/rms-token-provider';
import { createStaffTokenStore } from '../staff-auth/token-store';
import { HotelManagementService } from '../services/hotel-management-service';
import { OtaCredentialService } from '../services/ota-credential-service';

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
  channelRegistry: ReadonlyMap<ChannelId, ChannelAdapter>;
  /** rms-server 的认证栈——`StaffAuthService` 与业务 gateway 共用同一份。 */
  rms: Readonly<{
    origin: string;
    authClient: ReturnType<typeof createRmsAuthClient>;
    tokens: RmsTokenProvider;
    /** 已注入 Bearer / UA、并在 401 时重试一次的 fetch。 */
    fetch: typeof globalThis.fetch;
  }>;
  /**
   * 由 window scope 在创建 BrowserManager 后回填 —— credential 归并时需要
   * 让旧 partition 退休，而 BrowserManager 是窗口级的。窗口不存在时为空操作。
   */
  setPartitionRetirer(retire: ((partitionName: string) => Promise<void>) | null): void;
  /** 由 window scope 回填：账号绑定成功后通知渲染进程刷新。 */
  setAccountBoundNotifier(notify: ((channel: ChannelId) => void) | null): void;
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
   * 绑定时给远端的 cookie 快照：调用瞬间从该 partition 的实时 session 读取，
   * 不落本地、不记日志（日志只记条数）。sessionFactory 是进程级的，所以这个
   * 能力不需要等窗口就绪。
   */
  const readCookieSnapshot = async (partitionName: string) => {
    const cookies = await sessionFactory.sessionForAccount(partitionName).cookies.get({});
    return cookies.map((cookie) => ({
      domain: cookie.domain ?? '',
      name: cookie.name,
      value: cookie.value,
    }));
  };

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
  const rmsAuthClient = createRmsAuthClient({ origin: rmsOrigin, fetch: rmsFetch, logger });
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

  // 窗口级能力的回填槽位：window scope 建好 BrowserManager / 主窗口后写入。
  let retirePartition: ((partitionName: string) => Promise<void>) | null = null;
  let notifyAccountBound: ((channel: ChannelId) => void) | null = null;

  const otaCredentialService = new OtaCredentialService({
    discoverCtrip: createCtripDiscovery(logger),
    discoverDouyin: createDouyinDiscovery(logger),
    discoverMeituan: createMeituanDiscovery(logger),
    credentialRepository: otaCredentialRepository,
    generateCredentialId: () => randomUUID(),
    removePendingPartition: (partitionName) => removePendingPartition(userDataDir, partitionName),
    onCredentialPartitionReplaced: (previousPartitionName) =>
      retirePartition?.(previousPartitionName),
    logger,
    onAccountBound: (channel) => notifyAccountBound?.(channel),
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
      }),
      otaAccountGateway: new HttpRmsOtaAccountGateway({
        origin: rmsOrigin,
        fetch: authenticatedRmsFetch,
        logger,
      }),
      otaHotelRepository,
      otaCredentialRepository,
      readCookieSnapshot: (partitionName) => readCookieSnapshot(partitionName),
      generateRequestId: () => randomUUID(),
      logger,
    }),
    otaCredentialService,
    channelRegistry: createChannelRegistry(logger),
    rms: {
      origin: rmsOrigin,
      authClient: rmsAuthClient,
      tokens: rmsTokens,
      fetch: authenticatedRmsFetch,
    },
    setPartitionRetirer(retire) {
      retirePartition = retire;
    },
    setAccountBoundNotifier(notify) {
      notifyAccountBound = notify;
    },
    dispose() {
      database.close();
      logger.info('Application database closed');
    },
  };
}
