import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createWindowsInstallDiagnostic } from '../create-windows-install-diagnostic.mjs';

test('generates a versioned launcher beside the unchanged installer', async () => {
  const releaseDir = await mkdtemp(path.join(os.tmpdir(), 'xiaozhi-diagnostic-test-'));
  const installer = path.join(releaseDir, '小智酒店管家-setup.exe');
  await writeFile(installer, 'installer bytes');

  const launcher = await createWindowsInstallDiagnostic({
    releaseDir,
    productName: '小智酒店管家',
    squirrelName: 'xiaozhi-hotel',
    version: '1.0.6',
  });

  assert.equal(path.basename(launcher), '小智酒店管家-1.0.6-diagnostic-install.cmd');
  assert.equal(await readFile(installer, 'utf8'), 'installer bytes');
  const content = await readFile(launcher, 'ascii');
  assert.match(content, /xiaozhi-hotel/);
  assert.match(content, /TARGET_VERSION=1\.0\.6/);
  assert.match(content, /set "PRODUCT=%~n0"/);
  assert.match(content, /set "PRODUCT=%PRODUCT:-1\.0\.6-diagnostic-install=%"/);
  assert.match(content, /set "SETUP=%~dp0%PRODUCT%-setup\.exe"/);
  assert.doesNotMatch(content, /\*-setup\.exe/);
  assert.match(content, /'app-'\+\$env:TARGET_VERSION/);
  assert.match(content, /SquirrelSetup\.log/);
  assert.match(content, /Squirrel-Install\.log/);
  assert.match(content, /INSTALL_EXIT/);
  assert.match(content, /setlocal EnableExtensions DisableDelayedExpansion/);
  assert.match(content, /%SystemRoot%\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe/);
  assert.match(content, /MessageBox/);
});

test('fails when the expected installer is missing', async () => {
  const releaseDir = await mkdtemp(path.join(os.tmpdir(), 'xiaozhi-diagnostic-test-'));
  await assert.rejects(
    createWindowsInstallDiagnostic({
      releaseDir,
      productName: '小智酒店管家',
      squirrelName: 'xiaozhi-hotel',
      version: '1.0.6',
    }),
    /安装程序不存在/,
  );
});

test(
  'runs under native Windows CMD and has built-in PowerShell available',
  { skip: process.platform !== 'win32' },
  async () => {
    const releaseDir = await mkdtemp(path.join(os.tmpdir(), 'xiaozhi-diagnostic-test-'));
    const installer = path.join(releaseDir, '小智酒店管家-setup.exe');
    await writeFile(installer, 'fixture');
    const launcher = await createWindowsInstallDiagnostic({
      releaseDir,
      productName: '小智酒店管家',
      squirrelName: 'xiaozhi-hotel',
      version: '1.0.6',
    });
    await unlink(installer);

    const systemRoot = process.env.SystemRoot;
    assert.ok(systemRoot, 'SystemRoot must be defined on Windows');
    const cmd = spawnSync(path.join(systemRoot, 'System32', 'cmd.exe'), ['/d', '/c', launcher], {
      input: '\r\n',
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(cmd.status, 2, cmd.stderr);
    assert.match(cmd.stdout, /Setup executable was not found/);

    const powershell = spawnSync(
      path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      [
        '-NoProfile',
        '-Command',
        'Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop; Write-Output ready',
      ],
      { encoding: 'utf8', timeout: 10_000 },
    );
    assert.equal(powershell.status, 0, powershell.stderr);
    assert.match(powershell.stdout, /ready/);
  },
);
