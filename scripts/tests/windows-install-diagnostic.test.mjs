import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises';
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
  assert.match(content, /for %%F in \("%~dp0\*-setup\.exe"\)/);
  assert.doesNotMatch(content, /set "PRODUCT=%~n0"/);
  assert.match(content, /set "APP_FOLDER=%LOCALAPPDATA%\\%SQUIRREL_NAME%\\app-%TARGET_VERSION%"/);
  assert.match(content, /SquirrelSetup\.log/);
  assert.match(content, /Squirrel-Install\.log/);
  assert.match(content, /INSTALL_EXIT/);
  assert.match(content, /set "DIAG_LOG=%~dp0install-diagnostic-1\.0\.6\.log"/);
  assert.ok(content.indexOf('> "%DIAG_LOG%"') < content.indexOf('if not defined SETUP'));
  assert.match(content, /if not exist "%DIAG_LOG%" goto log_fallback/);
  assert.match(content, /AppendAllText/);
  assert.match(content, /setlocal EnableExtensions DisableDelayedExpansion/);
  assert.match(content, /%SystemRoot%\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe/);
  assert.match(content, /type "%DIAG_LOG%"/);
  assert.doesNotMatch(content, /MessageBox/);
  assert.ok(content.indexOf('type "%DIAG_LOG%"') < content.lastIndexOf('pause'));
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
    assert.match(cmd.stdout, /Installation diagnostic for version 1\.0\.6/);
    assert.match(cmd.stdout, /Files beside this diagnostic launcher:/);
    const diagnostic = await readFile(
      path.join(releaseDir, 'install-diagnostic-1.0.6.log'),
      'utf8',
    );
    assert.match(diagnostic, /Setup executable was not found/);

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

test(
  'writes a diagnostic log after a successful installer exit on Windows',
  { skip: process.platform !== 'win32' },
  async () => {
    const releaseDir = await mkdtemp(path.join(os.tmpdir(), 'xiaozhi-diagnostic-test-'));
    const systemRoot = process.env.SystemRoot;
    assert.ok(systemRoot, 'SystemRoot must be defined on Windows');
    await copyFile(
      path.join(systemRoot, 'System32', 'hostname.exe'),
      path.join(releaseDir, '小智酒店管家-setup.exe'),
    );
    const launcher = await createWindowsInstallDiagnostic({
      releaseDir,
      productName: '小智酒店管家',
      squirrelName: 'xiaozhi-hotel',
      version: '1.0.6',
    });
    const renamedLauncher = path.join(releaseDir, '小智酒店管家-1.0.6-诊断.cmd');
    await copyFile(launcher, renamedLauncher);

    const cmd = spawnSync(
      path.join(systemRoot, 'System32', 'cmd.exe'),
      ['/d', '/c', renamedLauncher],
      {
        input: '\r\n',
        encoding: 'utf8',
        timeout: 10_000,
      },
    );
    assert.equal(cmd.status, 0, cmd.stderr);
    assert.match(cmd.stdout, /Installer exit code: 0/);
    assert.match(cmd.stdout, /Squirrel log path:/);
    const diagnostic = await readFile(
      path.join(releaseDir, 'install-diagnostic-1.0.6.log'),
      'utf8',
    );
    assert.match(diagnostic, /Installer exit code: 0/);
    assert.match(diagnostic, /Setup executable: /);
    assert.match(diagnostic, /App folder exists: (True|False)/);
    assert.match(diagnostic, /Squirrel log/);
  },
);
