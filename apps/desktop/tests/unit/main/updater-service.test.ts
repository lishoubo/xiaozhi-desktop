import { describe, expect, it, vi } from 'vitest';
import type { StaffIdentity } from '@hotel-butler/api';
import {
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
  };
}

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
