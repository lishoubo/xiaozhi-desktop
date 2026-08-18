import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readOrCreateDeviceId } from '../../../src/main/file-store/device-id';
import type { AppLogger } from '../../../src/shared/logging';

const directories: string[] = [];

function tempDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaozhi-device-id-'));
  directories.push(directory);
  return directory;
}

function stubLogger(): AppLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as AppLogger;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe('设备标识', () => {
  it('首次调用生成并落盘', async () => {
    const directory = tempDir();

    const deviceId = await readOrCreateDeviceId(directory, stubLogger());

    expect(deviceId).toMatch(/^[0-9a-f-]{36}$/);
    const persisted: unknown = JSON.parse(
      fs.readFileSync(path.join(directory, 'device-id.json'), 'utf8'),
    );
    expect(persisted).toEqual({ deviceId });
  });

  it('二次调用返回同一个值', async () => {
    const directory = tempDir();

    const first = await readOrCreateDeviceId(directory, stubLogger());
    const second = await readOrCreateDeviceId(directory, stubLogger());

    expect(second).toBe(first);
  });

  it('文件损坏时重新生成并覆盖，不抛错', async () => {
    const directory = tempDir();
    fs.writeFileSync(path.join(directory, 'device-id.json'), 'not json at all', 'utf8');
    const logger = stubLogger();

    const deviceId = await readOrCreateDeviceId(directory, logger);

    expect(deviceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(logger.warn).toHaveBeenCalled();
    // 已自愈：下一次读到的就是刚写下的那个。
    expect(await readOrCreateDeviceId(directory, stubLogger())).toBe(deviceId);
  });

  it('内容结构不符时同样重新生成', async () => {
    const directory = tempDir();
    fs.writeFileSync(path.join(directory, 'device-id.json'), JSON.stringify({}), 'utf8');

    const deviceId = await readOrCreateDeviceId(directory, stubLogger());

    expect(deviceId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('无法落盘时仍返回可用标识，不阻断登录', async () => {
    // 传一个"父路径是文件"的目录：mkdir 与 writeFile 都会失败。
    const directory = tempDir();
    const blocker = path.join(directory, 'blocker');
    fs.writeFileSync(blocker, 'x', 'utf8');
    const logger = stubLogger();

    const deviceId = await readOrCreateDeviceId(path.join(blocker, 'nested'), logger);

    expect(deviceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(logger.warn).toHaveBeenCalled();
  });
});
