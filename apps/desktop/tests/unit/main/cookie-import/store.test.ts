import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { toChannelId } from '../../../../src/main/ids';
import {
  listImportedChannels,
  readImportedCookies,
  writeImportedCookies,
} from '../../../../src/main/cookie-import/store';

const temporaryDirectories: string[] = [];

function temporaryUserDataDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-butler-cookie-store-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

const manifest = { importedAt: '2026-08-03T00:00:00.000Z', sourceId: 'chrome' as const };

describe('writeImportedCookies / readImportedCookies', () => {
  it('一次导入按渠道分别写入，互不覆盖', async () => {
    const userDataDir = temporaryUserDataDir();
    await writeImportedCookies(
      userDataDir,
      toChannelId('douyin'),
      [{ name: 'a', value: '1' } as never],
      manifest,
    );
    await writeImportedCookies(
      userDataDir,
      toChannelId('ctrip'),
      [{ name: 'b', value: '2' } as never],
      manifest,
    );

    const douyin = await readImportedCookies(userDataDir, toChannelId('douyin'));
    const ctrip = await readImportedCookies(userDataDir, toChannelId('ctrip'));
    expect(douyin?.cookies).toEqual([{ name: 'a', value: '1' }]);
    expect(ctrip?.cookies).toEqual([{ name: 'b', value: '2' }]);
  });

  it('同渠道再次导入直接覆盖旧文件', async () => {
    const userDataDir = temporaryUserDataDir();
    await writeImportedCookies(
      userDataDir,
      toChannelId('douyin'),
      [{ name: 'old', value: '1' } as never],
      manifest,
    );
    await writeImportedCookies(
      userDataDir,
      toChannelId('douyin'),
      [{ name: 'new', value: '2' } as never],
      { importedAt: '2026-08-03T01:00:00.000Z', sourceId: 'edge' },
    );

    const result = await readImportedCookies(userDataDir, toChannelId('douyin'));
    expect(result?.cookies).toEqual([{ name: 'new', value: '2' }]);
    expect(result?.manifest.sourceId).toBe('edge');
  });

  it('读取未导入过的渠道返回 null，不抛错', async () => {
    const userDataDir = temporaryUserDataDir();
    await expect(readImportedCookies(userDataDir, toChannelId('meituan'))).resolves.toBeNull();
  });
});

describe('listImportedChannels', () => {
  it('没有任何导入记录时返回空数组', async () => {
    const userDataDir = temporaryUserDataDir();
    await expect(listImportedChannels(userDataDir)).resolves.toEqual([]);
  });

  it('列出所有已导入渠道及其导入时间', async () => {
    const userDataDir = temporaryUserDataDir();
    await writeImportedCookies(
      userDataDir,
      toChannelId('douyin'),
      [{ name: 'a', value: '1' } as never],
      { importedAt: '2026-08-03T00:00:00.000Z', sourceId: 'chrome' },
    );
    await writeImportedCookies(
      userDataDir,
      toChannelId('ctrip'),
      [{ name: 'b', value: '2' } as never],
      { importedAt: '2026-08-04T00:00:00.000Z', sourceId: 'edge' },
    );

    const summaries = await listImportedChannels(userDataDir);
    expect(summaries).toHaveLength(2);
    expect(summaries).toEqual(
      expect.arrayContaining([
        { channel: toChannelId('douyin'), importedAt: '2026-08-03T00:00:00.000Z' },
        { channel: toChannelId('ctrip'), importedAt: '2026-08-04T00:00:00.000Z' },
      ]),
    );
  });
});
