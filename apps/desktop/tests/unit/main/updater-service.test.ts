import { describe, expect, it, vi } from 'vitest';
import type { StaffIdentity } from '@hotel-butler/api';
import {
  RECHECK_BASE_MS,
  RECHECK_JITTER_MS,
  UpdaterService,
  type UpdaterServiceDependencies,
} from '../../../src/main/services/updater-service';
import { digestPhone } from '../../../src/main/updater/phone-digest';

const SALT = 'test-salt';
const PHONE = '13800138000';
const FEED_URL = 'https://bucket.example.com/updates';
const MANIFEST_URL = 'https://bucket.example.com/update-manifest.json';

function identityWith(phone: string | null | undefined): StaffIdentity {
  return {
    userId: 1,
    username: 'tester',
    phone,
    fullName: null,
    role: 'STAFF',
    orgId: 1,
    accessibleHotelIds: [],
    permissions: [],
  };
}

function createService(overrides: Partial<UpdaterServiceDependencies> = {}) {
  const autoUpdater = {
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(),
    onUpdateDownloaded: vi.fn(),
    onError: vi.fn(),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const reportError = vi.fn();
  const onUpdateReady = vi.fn();
  const fetchManifest = vi.fn(async () => ({
    allowAll: false,
    allowlist: [digestPhone(PHONE, SALT)],
  }));

  const onManualUpdateAvailable = vi.fn();

  /**
   * 手动时钟：记下被排期的回调与延时，由测试显式触发。间隔以小时计，真等不现实。
   */
  const timers: { callback: () => void; delayMs: number }[] = [];
  let nextTimerId = 1;
  const setTimer = vi.fn((callback: () => void, delayMs: number) => {
    timers.push({ callback, delayMs });
    return nextTimerId++ as unknown as NodeJS.Timeout;
  });
  const clearTimer = vi.fn();

  /** 触发最近一次排期的回调，模拟"时间到了"。 */
  const advance = async (): Promise<void> => {
    const timer = timers.pop();
    if (timer === undefined) throw new Error('没有待触发的定时器');
    timer.callback();
    // 回调内部是 void 的异步链，让微任务跑完再断言。
    await vi.waitFor(() => undefined);
  };

  const service = new UpdaterService({
    autoUpdater,
    feedUrl: FEED_URL,
    manifestUrl: MANIFEST_URL,
    salt: SALT,
    platform: 'win32',
    arch: 'x64',
    currentVersion: '1.0.0',
    fetchManifest,
    onUpdateReady,
    onManualUpdateAvailable,
    logger,
    reportError,
    setTimer,
    clearTimer,
    // 抖动固定成 0，断言间隔时才有确定值；抖动区间另有用例覆盖。
    random: () => 0,
    ...overrides,
  });

  return {
    service,
    autoUpdater,
    logger,
    reportError,
    onUpdateReady,
    onManualUpdateAvailable,
    fetchManifest,
    setTimer,
    clearTimer,
    timers,
    advance,
  };
}

/**
 * 断言取 service 导出的常量，而非在这里复述一遍数值：真机验证时会临时把间隔
 * 调小（分钟级），硬编码会让这些用例跟着假失败，掩盖真正的回归。
 */

describe('UpdaterService.checkOnce', () => {
  it('命中名单时启动 Squirrel', async () => {
    const { service, autoUpdater } = createService();

    await service.checkOnce(identityWith(PHONE));

    expect(autoUpdater.setFeedURL).toHaveBeenCalledWith({ url: FEED_URL });
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledOnce();
  });

  /**
   * macOS 的更新替换要求新旧产物签名身份一致，而本项目不做签名。启动 Squirrel
   * 只会产生必然失败的噪声——所以命中名单后也只提示，不自动更新。
   */
  it.each(['darwin', 'linux'] as const)('非 Windows 平台不启动 Squirrel（%s）', async (platform) => {
    const { service, autoUpdater } = createService({ platform });

    await service.checkOnce(identityWith(PHONE));

    expect(autoUpdater.setFeedURL).not.toHaveBeenCalled();
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('未配置更新源时不检查', async () => {
    const { service, autoUpdater, fetchManifest, logger } = createService({
      feedUrl: null,
      manifestUrl: null,
      salt: null,
    });

    await service.checkOnce(identityWith(PHONE));

    expect(fetchManifest).not.toHaveBeenCalled();
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('not enabled'));
  });

  /** 服务商员工可能没有手机号；身份不足以判定灰度时保守不升。 */
  it.each([
    ['为 null', null],
    ['缺失', undefined],
    ['空白串', '   '],
  ])('手机号%s时不检查', async (_label, phone) => {
    const { service, autoUpdater, fetchManifest } = createService();

    await service.checkOnce(identityWith(phone));

    expect(fetchManifest).not.toHaveBeenCalled();
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('未命中名单时不启动 Squirrel', async () => {
    const { service, autoUpdater } = createService({
      fetchManifest: vi.fn(async () => ({ allowAll: false, allowlist: ['other-digest'] })),
    });

    await service.checkOnce(identityWith(PHONE));

    expect(autoUpdater.setFeedURL).not.toHaveBeenCalled();
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('allowAll 时任何已登录用户都启动', async () => {
    const { service, autoUpdater } = createService({
      fetchManifest: vi.fn(async () => ({ allowAll: true, allowlist: [] })),
    });

    await service.checkOnce(identityWith('13900139000'));

    expect(autoUpdater.checkForUpdates).toHaveBeenCalledOnce();
  });

  /** 三个触发点（login / loginWithPhoneCode / currentSession）会连着调，不能重复下载。 */
  it('同一次运行只检查一次', async () => {
    const { service, autoUpdater, fetchManifest } = createService();

    await service.checkOnce(identityWith(PHONE));
    await service.checkOnce(identityWith(PHONE));
    await service.checkOnce(identityWith(PHONE));

    expect(fetchManifest).toHaveBeenCalledOnce();
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledOnce();
  });

  it('名单结构非法时不启动，且不抛', async () => {
    const { service, autoUpdater, logger } = createService({
      fetchManifest: vi.fn(async () => ({ nonsense: true })),
    });

    await expect(service.checkOnce(identityWith(PHONE))).resolves.toBeUndefined();

    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('malformed'));
  });

  /** 更新源不可达是最常见的失败，绝不能冒泡成启动失败。 */
  it('拉取名单失败时不抛，且已上报', async () => {
    const failure = new Error('network unreachable');
    const { service, autoUpdater, reportError, logger } = createService({
      fetchManifest: vi.fn(async () => {
        throw failure;
      }),
    });

    await expect(service.checkOnce(identityWith(PHONE))).resolves.toBeUndefined();

    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledWith(failure, { operation: 'update-check' });
  });
});

/** macOS 不能自动更新，命中名单后只提示用户手动下载。 */
describe('UpdaterService.checkOnce —— 手动更新提示（非 win32）', () => {
  const macManifest = (extra: Record<string, unknown>) =>
    vi.fn(async () => ({
      allowAll: false,
      allowlist: [digestPhone(PHONE, SALT)],
      ...extra,
    }));

  it('有新版本时按架构给下载地址', async () => {
    const { service, onManualUpdateAvailable } = createService({
      platform: 'darwin',
      arch: 'arm64',
      currentVersion: '1.0.0',
      fetchManifest: macManifest({
        latestVersion: '1.0.1',
        downloadUrls: { arm64: 'https://oss/arm64.zip', x64: 'https://oss/x64.zip' },
      }),
    });

    await service.checkOnce(identityWith(PHONE));

    expect(onManualUpdateAvailable).toHaveBeenCalledWith({
      latestVersion: '1.0.1',
      downloadUrl: 'https://oss/arm64.zip',
    });
  });

  it('已是最新版时不提示', async () => {
    const { service, onManualUpdateAvailable } = createService({
      platform: 'darwin',
      currentVersion: '1.0.1',
      fetchManifest: macManifest({ latestVersion: '1.0.1' }),
    });

    await service.checkOnce(identityWith(PHONE));

    expect(onManualUpdateAvailable).not.toHaveBeenCalled();
  });

  /** 发版时容易漏填；不该因此弹一个内容不明的通知。 */
  it('名单里没有 latestVersion 时不提示', async () => {
    const { service, onManualUpdateAvailable } = createService({
      platform: 'darwin',
      fetchManifest: macManifest({}),
    });

    await service.checkOnce(identityWith(PHONE));

    expect(onManualUpdateAvailable).not.toHaveBeenCalled();
  });

  /** 给错架构的包比不给更糟：用户下回来打不开，还以为是应用坏了。 */
  it('没有本机架构的下载地址时只报版本号', async () => {
    const { service, onManualUpdateAvailable } = createService({
      platform: 'darwin',
      arch: 'arm64',
      fetchManifest: macManifest({
        latestVersion: '1.0.1',
        downloadUrls: { x64: 'https://oss/x64.zip' },
      }),
    });

    await service.checkOnce(identityWith(PHONE));

    expect(onManualUpdateAvailable).toHaveBeenCalledWith({
      latestVersion: '1.0.1',
      downloadUrl: null,
    });
  });

  it('未命中名单时不提示', async () => {
    const { service, onManualUpdateAvailable } = createService({
      platform: 'darwin',
      fetchManifest: vi.fn(async () => ({
        allowAll: false,
        allowlist: ['other'],
        latestVersion: '1.0.1',
      })),
    });

    await service.checkOnce(identityWith(PHONE));

    expect(onManualUpdateAvailable).not.toHaveBeenCalled();
  });
});

describe('UpdaterService 事件', () => {
  it('下载完成时通知渲染进程', async () => {
    const { service, autoUpdater, onUpdateReady } = createService();
    await service.checkOnce(identityWith(PHONE));

    const listener = autoUpdater.onUpdateDownloaded.mock.calls[0]?.[0];
    expect(listener).toBeDefined();
    listener?.();

    expect(onUpdateReady).toHaveBeenCalledOnce();
  });

  it('autoUpdater 报错时上报而不抛', async () => {
    const { service, autoUpdater, reportError } = createService();
    await service.checkOnce(identityWith(PHONE));

    const listener = autoUpdater.onError.mock.calls[0]?.[0];
    const failure = new Error('squirrel exploded');
    expect(() => listener?.(failure)).not.toThrow();

    expect(reportError).toHaveBeenCalledWith(failure, { operation: 'update-check' });
  });
});

/**
 * 应用常被连开数天不退出（酒店前台尤其如此）。只在登录时查一次意味着那类机器
 * 永远发现不了新版本——所以首次检查之后要挂定时复查。
 */
describe('UpdaterService —— 定时复查', () => {
  it('首次检查后排下一次，抖动为 0 时间隔即基础值', async () => {
    const { service, setTimer } = createService();

    await service.checkOnce(identityWith(PHONE));

    expect(setTimer).toHaveBeenCalledOnce();
    expect(setTimer.mock.calls[0]?.[1]).toBe(RECHECK_BASE_MS);
  });

  it('抖动落在 [基础值, 基础值 + 抖动上限) 区间内', async () => {
    // random() 取上确界，验证不会溢出到区间之外。
    const { service, setTimer } = createService({ random: () => 0.999999 });

    await service.checkOnce(identityWith(PHONE));

    const delay = setTimer.mock.calls[0]?.[1] ?? 0;
    expect(delay).toBeGreaterThanOrEqual(RECHECK_BASE_MS);
    expect(delay).toBeLessThan(RECHECK_BASE_MS + RECHECK_JITTER_MS);
  });

  it('到点后会再查一次，并继续排下一次', async () => {
    const { service, fetchManifest, advance, setTimer } = createService({ platform: 'darwin' });

    await service.checkOnce(identityWith(PHONE));
    expect(fetchManifest).toHaveBeenCalledOnce();

    await advance();

    expect(fetchManifest).toHaveBeenCalledTimes(2);
    expect(setTimer).toHaveBeenCalledTimes(2);
  });

  /** 更新源没配（dev / pre）时首次检查就返回了，没必要空转定时器。 */
  it('未配置更新源时不排定时器', async () => {
    const { service, setTimer } = createService({ feedUrl: null, manifestUrl: null, salt: null });

    await service.checkOnce(identityWith(PHONE));

    expect(setTimer).not.toHaveBeenCalled();
  });

  /**
   * Squirrel 的安装发生在退出时。包已经下好之后再查，既不会让它提前装，
   * 也只是往 OSS 多打一次请求。
   */
  it('Squirrel 已下载完成后不再复查', async () => {
    const { service, autoUpdater, fetchManifest, advance } = createService();

    await service.checkOnce(identityWith(PHONE));
    autoUpdater.onUpdateDownloaded.mock.calls[0]?.[0]?.();

    await advance();

    expect(fetchManifest).toHaveBeenCalledOnce();
  });

  it('dispose 后停止复查', async () => {
    const { service, clearTimer, setTimer } = createService();

    await service.checkOnce(identityWith(PHONE));
    service.dispose();

    expect(clearTimer).toHaveBeenCalledOnce();
    expect(setTimer).toHaveBeenCalledOnce();
  });
});
