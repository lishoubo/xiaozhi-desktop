import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toChannelId, toOtaCredentialId } from '../../../src/main/ids';
import { OtaTabService } from '../../../src/main/ota-tab/ota-tab-service';
import { readImportedCookies, writeImportedCookies } from '../../../src/main/cookie-import/store';

const temporaryDirectories: string[] = [];

function tempUserDataDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaozhi-ota-tab-service-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

const CTRIP = toChannelId('ctrip');

function setup(credential?: unknown) {
  const userDataDir = tempUserDataDir();
  const tab = { id: 'tab-1', channelId: CTRIP };
  const browserManager = {
    createAndNewPartition: vi.fn().mockResolvedValue({ tab, partitionName: 'persist:new' }),
    createWithAlreadyPartition: vi.fn().mockReturnValue(tab),
  };
  const loginDetector = { register: vi.fn() };
  const readInjectableCookies = vi.fn().mockResolvedValue([]);
  const service = new OtaTabService({
    userDataDir,
    browserManager: browserManager as never,
    loginDetector,
    otaCredentialRepository: { findById: vi.fn().mockReturnValue(credential ?? null) },
    readInjectableCookies,
  });
  return { service, browserManager, loginDetector, userDataDir, tab, readInjectableCookies };
}

describe('OtaTabService', () => {
  it('open() 新建 partition 并登记登录判定', async () => {
    const { service, browserManager, loginDetector } = setup();

    await service.open('prod', CTRIP, 'https://ctrip.com');

    expect(browserManager.createAndNewPartition).toHaveBeenCalledWith(
      'prod',
      CTRIP,
      'https://ctrip.com',
    );
    // 不带意图时 intent 为 undefined——普通新建账号，登录后不触发任何后续流程。
    expect(loginDetector.register).toHaveBeenCalledWith('tab-1', CTRIP, undefined);
  });

  /** 绑定入口的「新登录账号」走这条路：新账号可操作的门店未知，登录后要探测。 */
  it('open() 带意图时透传给登录判定', async () => {
    const { service, loginDetector } = setup();
    const intent = { kind: 'bind-hotel', requestId: 'req-1' } as const;

    await service.open('prod', CTRIP, 'https://ctrip.com', intent);

    expect(loginDetector.register).toHaveBeenCalledWith('tab-1', CTRIP, intent);
  });

  it('createFromCookie() 在该渠道没有已导入 cookie 时报错', async () => {
    const { service } = setup();

    await expect(service.createFromCookie('prod', CTRIP, 'https://ctrip.com')).rejects.toThrow(
      '该渠道尚未导入 Cookie',
    );
  });

  it('createFromCookie() 注入已导入 cookie，且不删除它（允许反复登录）', async () => {
    const { service, browserManager, userDataDir } = setup();
    await writeImportedCookies(userDataDir, CTRIP, [{ name: 'a', value: '1' } as never], {
      importedAt: '2026-08-05T00:00:00.000Z',
      sourceId: 'chrome',
    });

    await service.createFromCookie('prod', CTRIP, 'https://ctrip.com');

    expect(browserManager.createAndNewPartition).toHaveBeenCalledWith(
      'prod',
      CTRIP,
      'https://ctrip.com',
      { importedCookies: [{ name: 'a', value: '1' }] },
    );
    await expect(readImportedCookies(userDataDir, CTRIP)).resolves.not.toBeNull();
  });

  it('openExisting() 复用凭据的 partition；不传 intent 也照常登记登录判定', () => {
    const { service, browserManager, loginDetector } = setup({
      id: toOtaCredentialId('credential-1'),
      channel: CTRIP,
      partitionName: 'persist:existing',
    });

    service.openExisting('credential-1');

    expect(browserManager.createWithAlreadyPartition).toHaveBeenCalledWith(
      'persist:existing',
      CTRIP,
      expect.any(String),
    );
    // 登录判定与意图无关：不带意图也要判定，只是探测出的候选无人接收。
    expect(loginDetector.register).toHaveBeenCalledWith('tab-1', CTRIP, undefined);
  });

  it('openExisting() 把 intent 透传给登录判定', () => {
    const { service, loginDetector } = setup({
      id: toOtaCredentialId('credential-1'),
      channel: CTRIP,
      partitionName: 'persist:existing',
    });

    service.openExisting('credential-1', { kind: 'bind-hotel', requestId: 'req-1' });

    expect(loginDetector.register).toHaveBeenCalledWith('tab-1', CTRIP, {
      kind: 'bind-hotel',
      requestId: 'req-1',
    });
  });

  it('openExisting() 找不到凭据时报错', () => {
    const { service } = setup();

    expect(() => service.openExisting('credential-1')).toThrow('未找到该登录凭据');
  });

  /**
   * 绑定专用：**新 partition** + 原账号 cookie。复用旧 partition 会带上「上次选的
   * 门店」，渠道据此跳过选择页，用户就选不了这次要绑的那家。
   */
  it('openExistingInFreshPartition() 新开 partition 并注入原账号 cookie', async () => {
    const { service, browserManager, loginDetector, readInjectableCookies } = setup({
      id: toOtaCredentialId('credential-1'),
      channel: CTRIP,
      partitionName: 'persist:existing',
    });
    readInjectableCookies.mockResolvedValue([{ name: 'sid', value: 'v1' }]);

    await service.openExistingInFreshPartition('prod', 'credential-1', {
      kind: 'bind-hotel',
      requestId: 'req-1',
    });

    // cookie 取自账号原有的 partition……
    expect(readInjectableCookies).toHaveBeenCalledWith('persist:existing');
    // ……但开的是新 partition，不是复用那一个。
    expect(browserManager.createWithAlreadyPartition).not.toHaveBeenCalled();
    expect(browserManager.createAndNewPartition).toHaveBeenCalledWith(
      'prod',
      CTRIP,
      expect.any(String),
      { importedCookies: [{ name: 'sid', value: 'v1' }] },
    );
    expect(loginDetector.register).toHaveBeenCalledWith('tab-1', CTRIP, {
      kind: 'bind-hotel',
      requestId: 'req-1',
    });
  });

  it('openExistingInFreshPartition() 找不到凭据时报错', async () => {
    const { service } = setup();

    await expect(service.openExistingInFreshPartition('prod', 'credential-1')).rejects.toThrow(
      '未找到该登录凭据',
    );
  });
});
