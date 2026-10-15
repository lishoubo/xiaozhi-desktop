import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { createWindowsInstallerEntrypoints } from '../create-windows-installer-entrypoints.mjs';

test('keeps the original Setup beside a logged installation launcher', {
  skip: process.platform !== 'win32',
}, async () => {
  const releaseDir = await mkdtemp(path.join(os.tmpdir(), 'xiaozhi-wrapper-test-'));
  try {
    const original = path.join(releaseDir, 'setup.exe');
    await copyFile(path.join(process.env.WINDIR, 'System32', 'hostname.exe'), original);
    const { setupPath, uninstallPath } = await createWindowsInstallerEntrypoints({
      releaseDir,
      productName: '小智酒店管家',
      squirrelName: 'xiaozhi-hotel',
    });
    assert.equal(setupPath, path.join(releaseDir, '小智酒店管家安装程序.exe'));
    assert.equal(uninstallPath, path.join(releaseDir, '应用卸载.cmd'));
    assert.ok((await stat(original)).size > 0);
    const launch = spawnSync(setupPath, ['--no-success-dialog'], { encoding: 'utf8', timeout: 15000 });
    assert.equal(launch.status, 0, launch.error?.message ?? launch.stderr);
    assert.ok((await stat(original)).size > 0, 'original Setup was removed');
    assert.ok((await stat(setupPath)).size > 0, 'launcher was removed');
    const log = await readFile(path.join(releaseDir, 'install-launcher.log'), 'utf8');
    assert.match(log, /Original setup: .*setup\.exe/);
    assert.match(log, /Installer exit code; code=0/);

    const appPath = path.join(releaseDir, '小智酒店管家.exe');
    await copyFile(path.join(process.env.WINDIR, 'System32', 'ping.exe'), appPath);
    const runningApp = spawn(appPath, ['-t', '127.0.0.1'], { windowsHide: true, stdio: 'ignore' });
    try {
      await setTimeout(400);
      assert.equal(runningApp.exitCode, null, 'app fixture exited before the check');
      const blocked = spawnSync(setupPath, [], { timeout: 1200, windowsHide: true });
      assert.ok(blocked.status === 2 || blocked.error?.code === 'ETIMEDOUT',
        `installer did not block while the app was running: ${blocked.status}`);
    } finally {
      runningApp.kill();
      if (runningApp.exitCode === null) {
        await new Promise((resolve) => runningApp.once('exit', resolve));
      }
    }

    const uninstall = await readFile(uninstallPath, 'ascii');
    assert.match(uninstall, /xiaozhi-hotel\\Update\.exe/);
    assert.match(uninstall, /--uninstall/);
    assert.doesNotMatch(uninstall, /rmdir|rd \/s|userData/i);
  } finally {
    await rm(releaseDir, { recursive: true, force: true });
  }
});
