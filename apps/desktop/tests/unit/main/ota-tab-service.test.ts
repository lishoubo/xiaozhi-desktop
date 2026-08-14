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
const DOUYIN = toChannelId('douyin');

/** 清理是 fire-and-forget 的：开 tab 同步返回，删键在微任务里跑完。 */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function setup(credential?: unknown) {
  const userDataDir = tempUserDataDir();
  const tab = { id: 'tab-1', channelId: CTRIP };
  const browserManager = {
    createAndNewPartition: vi.fn().mockResolvedValue({ tab, partitionName: 'persist:new' }),
    createWithAlreadyPartition: vi.fn().mockReturnValue(tab),
  };
  const loginDetector = { register: vi.fn() };
  const removeSelectionKeys = vi.fn().mockResolvedValue([]);
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const service = new OtaTabService({
    userDataDir,
    browserManager: browserManager as never,
    loginDetector,
    otaCredentialRepository: { findById: vi.fn().mockReturnValue(credential ?? null) },
    removeSelectionKeys,
    logger,
  });
  return { service, browserManager, loginDetector, userDataDir, tab, removeSelectionKeys, logger };
}

describe('OtaTabService', () => {
  it('openForNewLogin() 新建 partition 并登记登录判定', async () => {
    const { service, browserManager, loginDetector } = setup();

    await service.openForNewLogin('prod', CTRIP, 'https://ctrip.com');

    expect(browserManager.createAndNewPartition).toHaveBeenCalledWith(
      'prod',
      CTRIP,
      'https://ctrip.com',
    );
    // 不带意图时 intent 为 undefined——普通新建账号，登录后不触发任何后续流程。
    expect(loginDetector.register).toHaveBeenCalledWith('tab-1', CTRIP, undefined);
  });

  /** 绑定入口的「新登录账号」走这条路：新账号可操作的门店未知，登录后要探测。 */
  it('openForNewLogin() 带意图时透传给登录判定', async () => {
    const { service, loginDetector } = setup();
    const intent = { kind: 'bind-hotel', requestId: 'req-1' } as const;

    await service.openForNewLogin('prod', CTRIP, 'https://ctrip.com', intent);

    expect(loginDetector.register).toHaveBeenCalledWith('tab-1', CTRIP, intent);
  });

  it('openWithImportedCookie() 在该渠道没有已导入 cookie 时报错', async () => {
    const { service } = setup();

    await expect(service.openWithImportedCookie('prod', CTRIP, 'https://ctrip.com')).rejects.toThrow(
      '该渠道尚未导入 Cookie',
    );
  });

  it('openWithImportedCookie() 注入已导入 cookie，且不删除它（允许反复登录）', async () => {
    const { service, browserManager, userDataDir } = setup();
    await writeImportedCookies(userDataDir, CTRIP, [{ name: 'a', value: '1' } as never], {
      importedAt: '2026-08-05T00:00:00.000Z',
      sourceId: 'chrome',
    });

    await service.openWithImportedCookie('prod', CTRIP, 'https://ctrip.com');

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
   * 绑定专用：**复用**账号原有 partition。此前是新开一份 + 搬 cookie，为的是甩掉
   * 「上次选的门店」；现在改成原地删那条记忆（见下一条用例），partition 零产出、
   * cookie 一个字节不动。
   */
  it('openExistingForBinding() 复用原 partition，不再新建也不搬 cookie', () => {
    const { service, browserManager, loginDetector } = setup({
      id: toOtaCredentialId('credential-1'),
      channel: CTRIP,
      partitionName: 'persist:existing',
    });

    service.openExistingForBinding('credential-1', {
      kind: 'bind-hotel',
      requestId: 'req-1',
    });

    // 复用账号原有 partition —— 不再新建、不再搬 cookie。
    expect(browserManager.createWithAlreadyPartition).toHaveBeenCalledWith(
      'persist:existing',
      CTRIP,
      expect.any(String),
    );
    expect(browserManager.createAndNewPartition).not.toHaveBeenCalled();
    expect(loginDetector.register).toHaveBeenCalledWith('tab-1', CTRIP, {
      kind: 'bind-hotel',
      requestId: 'req-1',
    });
  });

  /** 抖音会记住上次选的门店，绑第二家时必须先删掉那条记忆，否则跳过选店页。 */
  it('openExistingForBinding() 对抖音清掉门店选择记忆', async () => {
    const { service, removeSelectionKeys } = setup({
      id: toOtaCredentialId('credential-1'),
      channel: DOUYIN,
      partitionName: 'persist:douyin-existing',
    });

    service.openExistingForBinding('credential-1');
    await flushMicrotasks();

    expect(removeSelectionKeys).toHaveBeenCalledWith('tab-1', ['core:PoiSwitch:']);
  });

  /** 携程/美团后台没有选店页，没有可清的记忆 —— 连脚本都不该注入。 */
  it('openExistingForBinding() 对携程不注入清理脚本', async () => {
    const { service, removeSelectionKeys } = setup({
      id: toOtaCredentialId('credential-1'),
      channel: CTRIP,
      partitionName: 'persist:existing',
    });

    service.openExistingForBinding('credential-1');
    await flushMicrotasks();

    expect(removeSelectionKeys).not.toHaveBeenCalled();
  });

  /** 清理是尽力而为：失败只记警告，标签页照常打开，用户仍能看见页面自己判断。 */
  it('openExistingForBinding() 清理失败不影响开标签页', async () => {
    const { service, removeSelectionKeys, logger } = setup({
      id: toOtaCredentialId('credential-1'),
      channel: DOUYIN,
      partitionName: 'persist:douyin-existing',
    });
    removeSelectionKeys.mockRejectedValue(new Error('tab gone'));

    expect(() => service.openExistingForBinding('credential-1')).not.toThrow();
    await flushMicrotasks();

    expect(logger.warn).toHaveBeenCalledWith(
      'Binding selection memory could not be reset',
      expect.objectContaining({ channel: DOUYIN }),
    );
  });

  it('openExistingForBinding() 找不到凭据时报错', () => {
    const { service } = setup();

    expect(() => service.openExistingForBinding('credential-1')).toThrow('未找到该登录凭据');
  });
});
