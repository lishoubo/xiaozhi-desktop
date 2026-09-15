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

  const service = new UpdaterService({
    autoUpdater,
    feedUrl: FEED_URL,
    manifestUrl: MANIFEST_URL,
    salt: SALT,
    platform: 'win32',
    fetchManifest,
    onUpdateReady,
    logger,
    reportError,
    ...overrides,
  });

  return { service, autoUpdater, logger, reportError, onUpdateReady, fetchManifest };
}

describe('UpdaterService.checkOnce', () => {
  it('命中名单时启动 Squirrel', async () => {
    const { service, autoUpdater } = createService();

    await service.checkOnce(identityWith(PHONE));

    expect(autoUpdater.setFeedURL).toHaveBeenCalledWith({ url: FEED_URL });
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledOnce();
  });

  /**
   * macOS 的更新替换要求新旧产物签名身份一致，而本项目不做签名。启动更新器
   * 只会产生必然失败的噪声。
   */
  it.each(['darwin', 'linux'] as const)('非 Windows 平台不检查（%s）', async (platform) => {
    const { service, autoUpdater, fetchManifest } = createService({ platform });

    await service.checkOnce(identityWith(PHONE));

    expect(fetchManifest).not.toHaveBeenCalled();
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
